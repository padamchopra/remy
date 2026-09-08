import { createServer } from "node:http";
import { builtinModules } from "node:module";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "remy-thread-qa-"));
for (const key of Object.keys(process.env))
  if (/^(MC_|REMY_)/.test(key)) delete process.env[key];
process.env.MC_CONFIG_DIR = join(temp, "computer");
const workspacePath = join(temp, "release-workspace");
mkdirSync(workspacePath);
execFileSync("git", ["init", "-q", workspacePath]);
const bundle = join(temp, "worker.mjs");
await build({
  stdin: {
    contents: 'export { default, HubCoordinator } from "./hub/src/worker.ts";',
    resolveDir: root,
    loader: "ts",
  },
  outfile: bundle,
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["workerd", "worker", "browser"],
  external: ["node:*", "cloudflare:*"],
  plugins: [
    {
      name: "node-builtins",
      setup(build) {
        build.onResolve({ filter: /^[a-z]/ }, ({ path }) =>
          builtinModules.includes(path)
            ? { path: `node:${path}`, external: true }
            : undefined,
        );
      },
    },
  ],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire("file:///worker.js");',
  },
  logLevel: "silent",
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: "127.0.0.1",
    port: Number(process.env.QA_HUB_PORT ?? 0),
    workers: [
      {
        name: "hub",
        script: readFileSync(bundle, "utf8"),
        modules: true,
        compatibilityDate: "2026-09-04",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["OBJECTS"],
        durableObjects: {
          COORDINATOR: { className: "HubCoordinator", useSQLite: true },
        },
        bindings: {
          ENVIRONMENT: "staging",
          RELEASE: "qa",
          BETTER_AUTH_URL: "http://localhost",
        },
      },
    ],
  }),
);
const hubUrl = (await mf.ready).origin;
const db = await mf.getD1Database("DB");
for (const file of readdirSync(join(root, "hub/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  for (const statement of readFileSync(
    join(root, "hub/migrations", file),
    "utf8",
  )
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
}
const organizationId = "release-team";
const now = Date.now();
await db
  .prepare("INSERT INTO organizations VALUES (?,?,?,?)")
  .bind(organizationId, "Release team", now, now)
  .run();
const tokens = {};
for (const [id, name, kind] of [
  ["ada", "Ada", "web"],
  ["grace", "Grace", "phone"],
  ["computer-owner", "Ada", "computer"],
]) {
  const token = randomBytes(32).toString("base64url");
  tokens[id] = token;
  await db
    .prepare(
      "INSERT INTO user (id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)",
    )
    .bind(id, name, `${id}@example.test`, now, now)
    .run();
  await db
    .prepare("INSERT INTO memberships VALUES (?,?,?,?,?,?)")
    .bind(randomUUID(), organizationId, id, "owner", now, now)
    .run();
  await db
    .prepare(
      "INSERT INTO auth_sessions (id,user_id,client_kind,client_name,access_token_hash,access_expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind(
      randomUUID(),
      id,
      kind,
      name,
      createHash("sha256").update(token).digest("base64url"),
      now + 86400000,
      now,
      now,
    )
    .run();
}
const { setProviderAdapterForTest } = await import(
  "../../server/dist/provider-adapters/index.js"
);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
setProviderAdapterForTest({
  id: "claude",
  discoverModels: async () => [],
  answer: async () => undefined,
  createSession(_options, handlers) {
    let interrupted = false;
    return {
      close() {
        interrupted = true;
      },
      turn(input) {
        interrupted = false;
        const abort = new AbortController();
        return {
          interrupt() {
            interrupted = true;
            abort.abort();
          },
          done: (async () => {
            handlers.event({ type: "turn.started" });
            const id = randomUUID();
            const reply = input.prompt.includes("approval")
              ? "I’ll ask before changing the release notes."
              : "I’m checking the release notes with your latest feedback.";
            for (let end = 1; end <= reply.length; end += 4) {
              if (interrupted) return;
              handlers.event({
                type: "entry.updated",
                entry: { id, kind: "assistant", text: reply.slice(0, end) },
              });
              await wait(60);
            }
            handlers.event({
              type: "entry.updated",
              entry: { id, kind: "assistant", text: reply },
            });
            if (input.prompt.includes("approval"))
              await handlers.approve?.({
                tool: "Bash",
                input: { command: "git diff --stat" },
                title: "Review the release changes?",
                signal: abort.signal,
                allowAlways: true,
              });
            if (input.prompt.includes("question"))
              await handlers.answer?.({
                questions: [
                  {
                    question: "Which release should I prepare?",
                    header: "Release",
                    options: [
                      {
                        label: "Stable",
                        description: "Prepare the stable release.",
                      },
                      { label: "Preview", description: "Prepare a preview." },
                    ],
                  },
                ],
                signal: abort.signal,
              });
            handlers.event({ type: "turn.completed" });
          })(),
        };
      },
    };
  },
});
const { addWorkspace } = await import("../../server/dist/workspaces.js");
const {
  registerHubComputer,
  HubComputerConnection,
  stopHubComputerConnection,
} = await import("../../server/dist/hub-computer.js");
const { config } = await import("../../server/dist/config.js");
config.deviceName = "Studio";
const workspace = await addWorkspace("Release notes", workspacePath);
const registration = await registerHubComputer(
  hubUrl,
  organizationId,
  tokens["computer-owner"],
);
const capabilities = registration.capabilities;
stopHubComputerConnection();
const connection = new HubComputerConnection(
  registration,
  async () => capabilities,
);
connection.start();
const request = async (path, member = "ada", method = "GET", body) => {
  const response = await fetch(
    hubUrl + `/api/organizations/${organizationId}` + path,
    {
      method,
      headers: {
        authorization: `Bearer ${tokens[member]}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(`${response.status}: ${JSON.stringify(data)}`);
  return data;
};
for (let attempt = 0; attempt < 150; attempt++) {
  if (
    (await request("/computers")).computers.some(
      (computer) => computer.availability === "available",
    )
  )
    break;
  await wait(100);
}
const thread = await request(
  `/computers/${registration.computerId}/threads`,
  "ada",
  "POST",
  {
    workspaceId: workspace.id,
    title: "Prepare the release notes",
    visibility: "open",
  },
);
const controlToken = randomBytes(32).toString("base64url");
const control = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${controlToken}`) {
    res.writeHead(401);
    res.end();
    return;
  }
  if (req.url === "/disconnect") connection.stop();
  else if (req.url === "/reconnect") connection.start();
  else if (req.url === "/revoke-grace" || req.url === "/restore-grace") {
    await db
      .prepare("UPDATE auth_sessions SET revoked_at=? WHERE user_id=?")
      .bind(req.url === "/restore-grace" ? null : Date.now(), "grace")
      .run();
  } else if (req.url === "/reset") {
    await mf.unsafeEvictDurableObject("hub", "HubCoordinator", {
      id: (await mf.getDurableObjectNamespace("COORDINATOR"))
        .idFromName(`organization:${organizationId}`)
        .toString(),
    });
  } else {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(204);
  res.end();
});
await new Promise((resolve) => control.listen(0, "127.0.0.1", resolve));
const controlUrl = `http://127.0.0.1:${control.address().port}`;
const info = {
  controlUrl,
  controlToken,
  hubUrl,
  organizationId,
  computerId: registration.computerId,
  threadId: thread.id,
  tokens,
  temp,
};
writeFileSync(join(temp, "session.json"), JSON.stringify(info), {
  mode: 0o600,
});
console.log(`QA_SESSION=${join(temp, "session.json")}`);
console.log(`QA_HUB=${hubUrl} PID=${process.pid}`);
console.log(
  `QA_ROUTE=#/threads/${thread.id}?organization=${organizationId}&computer=${registration.computerId}`,
);
const cleanup = async () => {
  connection.stop();
  control.close();
  await mf.dispose();
  rmSync(temp, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
await new Promise(() => {});
