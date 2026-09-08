import { startConnectionProvider } from "./qa-connection-provider.mjs";
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
execFileSync("git", ["-C", workspacePath, "remote", "add", "origin", process.env.QA_GITHUB ? "https://github.com/release/remy.git" : "https://example.test/studio/release.git"]);
const oauth = process.env.QA_CONNECTIONS ? await startConnectionProvider() : undefined;
const bundle = join(temp, "worker.mjs");
await build({
  stdin: {
    contents: process.env.QA_HUB_WEB === "1" ? `
      import worker from "./hub/src/worker.ts";
      import { HubCoordinator as Coordinator } from "./hub/src/worker.ts";
      const secrets = env => ({ ...env, ...(env.QA_CONNECTIONS ? {LINEAR_CLIENT_SECRET:{get:async()=>"disposable-secret"},GITHUB_CONNECTION_CLIENT_SECRET:{get:async()=>"disposable-secret"},GITHUB_WEBHOOK_SECRET:{get:async()=>"disposable-webhook"},LINEAR_WEBHOOK_SECRET:{get:async()=>"disposable-linear-webhook"}} : {}), AUTH_SECRET: { get: async () => "disposable-qa-secret-with-more-than-thirty-two-characters" }, HOSTED_CONTROL_TOKEN: { get: async () => env.QA_HOSTED_TOKEN || "disposable-runtime-credential-for-failure-check" } });
      export class HubCoordinator extends Coordinator { constructor(ctx,env) { super(ctx,secrets(env)); } }
      export default { ...worker, fetch(request, env, ctx) {
        return worker.fetch(request, { ...secrets(env), BETTER_AUTH_URL: new URL(request.url).origin,
          AUTH_SECRET: { get: async () => "disposable-qa-secret-with-more-than-thirty-two-characters" },
          EMAILS: { send: async (mail) => { await env.DB.prepare("INSERT INTO qa_emails (recipient,url) VALUES (?,?)").bind(mail.recipient,mail.url).run(); } }
        }, ctx);
      } };
    ` : 'export { default, HubCoordinator } from "./hub/src/worker.ts";',
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
    ...(oauth ? [{name:"disposable-oauth-provider",setup(build) {
      build.onLoad({filter:/(connection-providers|github-connection|linear-connection)\.ts$/},async ({path})=>({loader:"ts",contents:readFileSync(path,"utf8")
        .replaceAll("https://github.com/login/oauth/authorize",oauth.url+"/authorize")
        .replaceAll("https://linear.app/oauth/authorize",oauth.url+"/authorize")
        .replaceAll("https://github.com/login/oauth/access_token",oauth.url+"/token")
        .replaceAll("https://api.linear.app/oauth/token",oauth.url+"/token")
        .replaceAll("https://api.linear.app/graphql",oauth.url+"/graphql")
        .replaceAll("https://api.github.com",oauth.url)}));
    }}] : []),
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
        ...(process.env.QA_HUB_WEB === "1" ? { assets: { directory: join(root, "web/dist"), binding: "ASSETS", run_worker_first: ["/api/*", "/health", "/invite/*"], routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: "single-page-application" } } } : {}),
        script: readFileSync(bundle, "utf8"),
        modules: true,
        compatibilityDate: "2026-09-04",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["OBJECTS"],
        ...(oauth?{queueProducers:{JOBS:"qa-connections"},queueConsumers:{"qa-connections":{maxBatchSize:1,maxBatchTimeout:0}}}:{}),
        durableObjects: {
          COORDINATOR: { className: "HubCoordinator", useSQLite: true },
        },
        bindings: {
          ...(oauth?{QA_CONNECTIONS:true,GITHUB_APP_ID:"12",LINEAR_CLIENT_ID:"disposable-linear",GITHUB_CONNECTION_CLIENT_ID:"disposable-github"}:{}),
          ENVIRONMENT: "staging",
          RELEASE: "qa",
          BETTER_AUTH_URL: process.env.QA_PUBLIC_HUB_URL ?? "http://localhost",
          ...(process.env.QA_HOSTED ? { HOSTED_CONTROL_URL: process.env.QA_HOSTED_CONTROL ?? "http://127.0.0.1:9", HOSTED_IMAGE: process.env.QA_HOSTED_IMAGE ?? "qa-image", QA_HOSTED_TOKEN: process.env.QA_HOSTED_TOKEN ?? "" } : {}),
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
    .split(/;(?=\s*(?:CREATE|INSERT|DROP|ALTER|PRAGMA|$))/i)
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(statement).run();
}
await db.prepare("CREATE TABLE qa_emails (recipient TEXT, url TEXT)").run();
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
  ["reader", "Lin", "web"],
  ["computer-owner", "Ada", "computer"],
]) {
  const token = randomBytes(32).toString("base64url");
  tokens[id] = token;
  const userId = id === "computer-owner" ? "ada" : id;
  if (id !== "computer-owner") {
  await db
    .prepare(
      "INSERT INTO user (id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)",
    )
    .bind(id, name, `${id}@example.test`, now, now)
    .run();
  await db
    .prepare("INSERT INTO memberships VALUES (?,?,?,?,?,?)")
    .bind(randomUUID(), organizationId, id, id === "grace" ? "member" : "owner", now, now)
    .run();
  }
  await db
    .prepare(
      "INSERT INTO auth_sessions (id,user_id,client_kind,client_name,access_token_hash,access_expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .bind(
      randomUUID(),
      userId,
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
            let toolReply;
            if(process.env.QA_BUILTINS && _options.developerInstructions?.includes("organization")) {
              const {Client}=await import("../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
              const {InMemoryTransport}=await import("../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js");
              const [clientSide,serverSide]=InMemoryTransport.createLinkedPair();const client=new Client({name:"Disposable model fixture",version:"1"});
              await _options.inProcessMcp.instance.connect(serverSide);await client.connect(clientSide);
              try {
                const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});if(result.isError)throw Error("Fixture tool failed");const {applyToolOutput}=await import("../../server/dist/transcript.js");const entry={id:crypto.randomUUID(),kind:"tool",tool:name};applyToolOutput(entry,result.content[0].text,10000);handlers.event({type:"entry.updated",entry});return JSON.parse(result.content[0].text.split("\n<remy-artifact>")[0]);};
                const {workspaces}=await call("list_organization_workspaces"),android=workspaces.find(w=>w.name==="Android");
                if(input.prompt.includes("Repeat the release review")) {const next=new Date(Date.now()+65000);await call("create_organization_routine",{name:"Daily release review",prompt:"Review the release notes.",projectId:android.id,cadence:"daily",hour:next.getUTCHours(),minute:next.getUTCMinutes(),timeZone:"UTC"});toolReply="The daily release review is scheduled.";}
                else if(input.prompt.includes("Send Android work")) {const {computers}=await call("list_organization_computers"),{rules}=await call("read_routing");await call("edit_routing",{rules:[{id:"android",name:"Android on Studio",workspaceId:android.id,target:{computerId:computers.find(c=>c.name==="Studio").computerId}},...rules.filter(r=>r.id!=="android")]});toolReply="Android work now goes to Studio.";}
                else if(input.prompt.includes("Create an Android ticket")){await call("create_organization_ticket",{workspaceId:android.id,title:"Check the Android release",prompt:"Review the next release."});toolReply="I created the Android release ticket.";}
              } finally {await client.close();}
            }
            const reply = toolReply ?? (input.prompt.includes("approval")
              ? "I’ll ask before changing the release notes."
              : "I’m checking the release notes with your latest feedback.");
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
if (process.env.QA_THREAD_PICKER) {
  const second = join(temp, "android-workspace"); mkdirSync(second); execFileSync("git", ["init", "-q", second]);
  execFileSync("git", ["-C", second, "remote", "add", "origin", "https://example.test/studio/android.git"]);
  await addWorkspace("Android", second);
}
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
if (!process.env.QA_COMPUTER_POLICY) await request(`/computers/${registration.computerId}`, "ada", "PATCH", { access: { mode: "organization", userIds: [], teamIds: [] } });
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
  const controlPath = new URL(req.url, "http://127.0.0.1");
  const askedThread = controlPath.searchParams.get("threadId") ?? thread.id;
  if(controlPath.pathname === "/github") {res.setHeader("content-type","application/json");res.end(JSON.stringify({actions:oauth?.actions,comments:oauth?.comments}));return;}
  if (controlPath.pathname === "/mail") {
    const value = await db.prepare("SELECT url FROM qa_emails WHERE recipient=? ORDER BY rowid DESC LIMIT 1").bind(controlPath.searchParams.get("email") ?? "").first();
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value ?? {})); return;
  } else if (controlPath.pathname === "/local-thread") {
    const { getChat } = await import("../../server/dist/chat.js");
    const local = getChat(askedThread);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ exists: !!local, state: local?.state }));
    return;
  } else if (controlPath.pathname === "/notify") {
    const { sendNotification } = await import("../../server/dist/notify.js");
    await sendNotification({ session: askedThread, title: "Release notes need you", message: "Review the release notes before publishing.", highPriority: true });
  } else if (req.url === "/disconnect") connection.stop();
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
  oauth?.close();
  await mf.dispose();
  rmSync(temp, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
await new Promise(() => {});
