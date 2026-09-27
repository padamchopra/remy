import { startHostedCodexFixture } from "./qa-codex-account.mjs";
import { startFakeOpenAIAuth } from "./fake-openai-auth.mjs";
import { startConnectionProvider } from "./qa-connection-provider.mjs";
import { fixtureReviewTurn, isReviewThread } from "./qa-review-fixture.mjs";
import { assertNoSecrets, cloneWithToken, loadQaEnv, qaRealInputs, seedPullRequest, writeGitCredentialHelper } from "./qa-github.mjs";
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
// QA_ENV_FILE=0 runs a fixture-only hub even when hub/.qa.env exists.
if (process.env.QA_ENV_FILE !== "0") loadQaEnv(process.env.QA_ENV_FILE || join(root, "hub/.qa.env"));
const real = qaRealInputs();
const temp = mkdtempSync(join(tmpdir(), "remy-thread-qa-"));
// However the run ends, its state (and any sandbox token file) goes with it.
process.on("exit", () => rmSync(temp, { recursive: true, force: true }));
for (const key of Object.keys(process.env))
  if (/^(MC_|REMY_)/.test(key)) delete process.env[key];
process.env.MC_CONFIG_DIR = join(temp, "computer");
// Started from inside a Claude Code session, the script inherits that host's
// session variables (its entrypoint, API proxy and auth refresh), which would
// make a real Claude thread use the host's session instead of this Mac's own
// sign-in. A person's own settings outside those names pass through.
if (real.realProviders) {
  if (process.env.CLAUDECODE) delete process.env.ANTHROPIC_BASE_URL;
  for (const key of Object.keys(process.env))
    if (/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW_)/.test(key)) delete process.env[key];
}
const codexFixture = process.env.QA_CODEX_ACCOUNT || process.env.QA_CHATGPT ? await startHostedCodexFixture(temp, root) : undefined;
// The hub's own ChatGPT device-code sign-in talks to a fake OpenAI auth server, never OpenAI.
const chatgptAuth = process.env.QA_CHATGPT ? await startFakeOpenAIAuth() : undefined;
if (codexFixture) { process.env.QA_HOSTED = "1"; process.env.QA_HOSTED_CONTROL = codexFixture.url; }
const workspacePath = join(temp, "release-workspace");
mkdirSync(workspacePath);
if (real.repository) await cloneWithToken(real.repository, workspacePath, writeGitCredentialHelper(temp, real.token));
else {
  execFileSync("git", ["init", "-q", workspacePath]);
  execFileSync("git", ["-C", workspacePath, "remote", "add", "origin", process.env.QA_GITHUB ? "https://github.com/release/remy.git" : "https://example.test/studio/release.git"]);
}
// Loopback-only proof that a request may seed a connection with a real token.
const seedToken = real.secrets.length ? randomBytes(32).toString("base64url") : undefined;
const oauth = process.env.QA_CONNECTIONS ? await startConnectionProvider() : undefined;
const bundle = join(temp, "worker.mjs");
await build({
  stdin: {
    contents: process.env.QA_HUB_WEB === "1" ? `
      import worker from "./hub/src/worker.ts";
      import { HubCoordinator as Coordinator } from "./hub/src/worker.ts";
      import { connectionsFor } from "./hub/src/connection-routes.ts";
      // Stores a real token exactly as the Connections flow does: the GitHub
      // personal access token path, or the Linear OAuth save and link.
      const seed = async (request, env) => {
        const { organizationId, userId, provider, token } = await request.json();
        const connections = connectionsFor(env);
        try {
          if (provider === "github") await connections.personalToken(organizationId, userId, token);
          else await connections.saveTokens(userId, "linear", { organization_id: organizationId, subject: userId, epoch: 0 }, { access_token: token });
          const listed = await connections.list(organizationId, userId);
          const label = provider === "github" ? listed.connections.find(c => c.provider === "github")?.label : listed.linearAccounts[0]?.label;
          return Response.json({ label });
        } catch (error) { return Response.json({ error: error?.message ?? "Seeding failed" }, { status: 400 }); }
      };
      const secrets = env => ({ ...env, ...(env.QA_CONNECTIONS ? {LINEAR_CLIENT_SECRET:{get:async()=>"disposable-secret"},GITHUB_CONNECTION_CLIENT_SECRET:{get:async()=>"disposable-secret"},GITHUB_WEBHOOK_SECRET:{get:async()=>"disposable-webhook"},LINEAR_WEBHOOK_SECRET:{get:async()=>"disposable-linear-webhook"}} : {}), AUTH_SECRET: { get: async () => "disposable-qa-secret-with-more-than-thirty-two-characters" }, HOSTED_CONTROL_TOKEN: { get: async () => env.QA_HOSTED_TOKEN || "disposable-runtime-credential-for-failure-check" } });
      export class HubCoordinator extends Coordinator { constructor(ctx,env) { super(ctx,secrets(env)); } }
      export default { ...worker, fetch(request, env, ctx) {
        if (env.QA_SEED_TOKEN && request.method === "POST" && new URL(request.url).pathname === "/__qa/connections") {
          if (request.headers.get("x-qa-seed") !== env.QA_SEED_TOKEN) return new Response(null, { status: 404 });
          return seed(request, { ...secrets(env), BETTER_AUTH_URL: new URL(request.url).origin });
        }
        return worker.fetch(request, { ...secrets(env), BETTER_AUTH_URL: new URL(request.url).origin, WEB_APP_URL: new URL(request.url).origin,
          AUTH_SECRET: { get: async () => "disposable-qa-secret-with-more-than-thirty-two-characters" },
          EMAIL_FROM: "no-reply@remy.example",
          EMAIL: { send: async (mail) => { const url = mail.text.split("\\n").find(line => line.startsWith("http")); if (!url) throw new Error("Missing email action"); await env.DB.prepare("INSERT INTO qa_emails (recipient,url) VALUES (?,?)").bind(mail.to,url).run(); return { messageId: "qa-delivered" }; } }
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
      // A real token means the real vendor: leave that vendor's endpoints alone.
      const vendor = (text, from, to, keep) => keep ? text : text.replaceAll(from, to);
      build.onLoad({filter:/(connection-providers|github-connection)\.ts$/},async ({path})=>{
        let text = readFileSync(path,"utf8");
        for (const [from, to, keep] of [
          ["https://github.com/login/oauth/authorize",oauth.url+"/authorize",real.repository],
          ["https://linear.app/oauth/authorize",oauth.url+"/authorize",real.linearToken],
          ["https://github.com/login/oauth/access_token",oauth.url+"/token",real.repository],
          ["https://api.linear.app/oauth/token",oauth.url+"/token",real.linearToken],
          ["https://api.linear.app/graphql",oauth.url+"/graphql",real.linearToken],
          ["https://api.github.com",oauth.url,real.repository],
        ]) text = vendor(text, from, to, keep);
        return {loader:"ts",contents:text};
      });
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
        ...(process.env.QA_HUB_WEB === "1" ? { assets: { directory: join(root, "web/dist"), binding: "ASSETS", run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: "single-page-application" } } } : {}),
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
          ...(seedToken ? { QA_SEED_TOKEN: seedToken } : {}),
          ENVIRONMENT: "staging",
          PREVIEW_ORIGINS: process.env.QA_PREVIEW_ORIGINS ?? "",
          RELEASE: "qa",
          BETTER_AUTH_URL: process.env.QA_PUBLIC_HUB_URL ?? "http://localhost",
          ...(chatgptAuth ? { CHATGPT_AUTH_ISSUER: chatgptAuth.url } : {}),
          ...(process.env.QA_HOSTED ? { HOSTED_CONTROL_URL: process.env.QA_HOSTED_CONTROL ?? "http://127.0.0.1:9", HOSTED_IMAGE: process.env.QA_HOSTED_IMAGE ?? "qa-image", QA_HOSTED_TOKEN: process.env.QA_HOSTED_TOKEN ?? "" } : {}),
        },
      },
    ],
  }),
);
const hubUrl = (await mf.ready).origin;
codexFixture?.setHubUrl(hubUrl);
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
  .prepare("INSERT INTO organizations (id,name,createdAt,updatedAt) VALUES (?,?,?,?)")
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
const seedConnection = async (userId, provider, token) => {
  const response = await fetch(hubUrl + "/__qa/connections", {
    method: "POST",
    headers: { "x-qa-seed": seedToken, "content-type": "application/json" },
    body: JSON.stringify({ organizationId, userId, provider, token }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`The ${provider} token for ${userId} was refused: ${data.error}`);
  return data.label;
};
const connected = {};
if (real.token) connected.ada = { github: await seedConnection("ada", "github", real.token) };
if (real.reviewerToken) connected.grace = { github: await seedConnection("grace", "github", real.reviewerToken) };
if (real.linearToken) (connected.ada ??= {}).linear = await seedConnection("ada", "linear", real.linearToken);
const pullRequests = real.repository && real.seed ? (await seedPullRequest(real.repository, real.token)).urls : [];
const { setProviderAdapterForTest } = await import(
  "../../server/dist/provider-adapters/index.js"
);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Real providers are whatever this Mac has signed in: Claude Code through
// HOME's own credentials, Codex and Cursor through theirs.
if (!real.realProviders) setProviderAdapterForTest({
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
            if (isReviewThread(_options.developerInstructions) && _options.inProcessMcp)
              toolReply = await fixtureReviewTurn({ ..._options, prompt: input.prompt, event: handlers.event })
                .catch((error) => `The review fixture could not finish: ${error.message}`);
            if(process.env.QA_BUILTINS && _options.developerInstructions?.includes("organization")) {
              const {Client}=await import("../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
              const {InMemoryTransport}=await import("../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js");
              const [clientSide,serverSide]=InMemoryTransport.createLinkedPair();const client=new Client({name:"Disposable model fixture",version:"1"});
              await _options.inProcessMcp.instance.connect(serverSide);await client.connect(clientSide);
              try {
                const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});if(result.isError)throw Error("Fixture tool failed");const {applyToolOutput}=await import("../../server/dist/transcript.js");const entry={id:crypto.randomUUID(),kind:"tool",tool:name};applyToolOutput(entry,result.content[0].text,10000);handlers.event({type:"entry.updated",entry});return JSON.parse(result.content[0].text.split("\n<remy-artifact>")[0]);};
                const {workspaces}=await call("list_organization_workspaces"),android=workspaces.find(w=>w.name==="Android");
                if(input.prompt.includes("Repeat the release review")) {const next=new Date(Date.now()+65000);await call("create_organization_routine",{name:"Daily release review",prompt:"Review the release notes.",projectId:android.id,cadence:"daily",hour:next.getUTCHours(),minute:next.getUTCMinutes(),timeZone:"UTC"});toolReply="The daily release review is scheduled.";}
              } finally {await client.close();}
            }
            // Says which of the named keys the thread's provider inherited:
            // "KEY=?" asks for the value, a bare KEY only whether it is set, so
            // a QA run proves delivery without writing a secret down.
            const asked = /Which values reach this thread: (.+)/.exec(input.prompt)?.[1];
            if (!toolReply && asked)
              toolReply = asked.trim().split(/\s+/).map((name) => {
                const key = name.replace(/=\?$/, ""), value = _options.env?.[key];
                return value === undefined ? `${key} is not set` : name.endsWith("=?") ? `${key}=${value}` : `${key} is set`;
              }).join(", ");
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
const workspace = await addWorkspace(real.repository ? real.repository.split("/")[1] : "Release notes", workspacePath);
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
// The organization's own record of the sandbox, which pull request lists and
// review starts are checked against, as adding it in Workspaces makes one.
const hubWorkspace = real.repository
  ? (await request("/workspaces", "ada", "POST", { name: real.repository.split("/")[1], origin: `https://github.com/${real.repository}` }))
  : undefined;
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
  if (chatgptAuth && controlPath.pathname === "/chatgpt-approve") {
    chatgptAuth.approve({ email: controlPath.searchParams.get("email") ?? "reviewer@example.test", accountId: controlPath.searchParams.get("account") ?? "acct-reviewer" });
    res.writeHead(204).end(); return;
  }
  if (chatgptAuth && controlPath.pathname === "/chatgpt-revoke") { chatgptAuth.revokeAll(); res.writeHead(204).end(); return; }
  if (chatgptAuth && controlPath.pathname === "/chatgpt-calls") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(chatgptAuth.calls)); return; }
  if (codexFixture && controlPath.pathname.startsWith("/codex-")) {
    if (controlPath.pathname === "/codex-approve") codexFixture.approve();
    else if (controlPath.pathname === "/codex-fail") codexFixture.approve(false);
    else if (controlPath.pathname === "/codex-disconnect") codexFixture.disconnect();
    else if (controlPath.pathname === "/codex-reconnect") codexFixture.reconnect();
    else if (controlPath.pathname === "/codex-restart") await codexFixture.restartAccount();
    else { res.writeHead(404).end(); return; }
    res.writeHead(204).end(); return;
  }
  if(controlPath.pathname === "/github") {res.setHeader("content-type","application/json");res.end(JSON.stringify({actions:oauth?.actions,comments:oauth?.comments}));return;}
  if (controlPath.pathname === "/mail") {
    const value = await db.prepare("SELECT url FROM qa_emails WHERE recipient=? ORDER BY rowid DESC LIMIT 1").bind(controlPath.searchParams.get("email") ?? "").first();
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(value ?? {})); return;
  } else if (controlPath.pathname === "/model-keys") {
    // Names only: the value never leaves the computer that was given it.
    const { hubModelKeys } = await import("../../server/dist/hub-model-keys.js");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ names: Object.keys(hubModelKeys()) }));
    return;
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
  // Account labels only; the tokens stay in the hub's encrypted store.
  connected,
  ...(real.repository ? { github: { repository: real.repository, workspaceId: hubWorkspace?.id, computerWorkspaceId: workspace.id, pullRequests } } : {}),
  realProviders: real.realProviders,
};
const session = JSON.stringify(info);
assertNoSecrets(session, real.secrets);
writeFileSync(join(temp, "session.json"), session, {
  mode: 0o600,
});
console.log(`QA_SESSION=${join(temp, "session.json")}`);
console.log(`QA_HUB=${hubUrl} PID=${process.pid}`);
for (const url of pullRequests) console.log(`QA_GITHUB_PULL_REQUEST=${url}`);
for (const [member, accounts] of Object.entries(connected))
  console.log(`QA_CONNECTED=${member} ${Object.entries(accounts).map(([provider, label]) => `${provider}:${label}`).join(" ")}`);
if (real.realProviders) console.log("QA_PROVIDERS=real");
console.log(
  `QA_ROUTE=#/threads/${thread.id}?organization=${organizationId}&computer=${registration.computerId}`,
);
const cleanup = async () => {
  connection.stop();
  codexFixture?.close();
  await chatgptAuth?.close();
  if(codexFixture) await codexFixture.restartAccount();
  control.close();
  oauth?.close();
  await mf.dispose();
  rmSync(temp, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
await new Promise(() => {});
