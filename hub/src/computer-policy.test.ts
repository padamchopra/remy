import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { D1ComputerStore } from "./computer-store.js";
import { D1OrganizationStore } from "./organization-store.js";
import { ComputerService } from "./computers.js";
import { HubNotifications, sendApplePush } from "./notifications.js";
import type { HubThread } from "@remy/contract";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(
    new URL("../migrations", import.meta.url),
  ).sort())
    sqlite.exec(
      readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"),
    );
  const prepare = (sql: string, values: unknown[] = []): unknown => ({
    bind: (...args: unknown[]) => prepare(sql, args),
    first: async () => sqlite.prepare(sql).get(...(values as never[])) ?? null,
    all: async () => ({
      results: sqlite.prepare(sql).all(...(values as never[])),
    }),
    run: async () => ({
      meta: {
        changes: Number(
          sqlite.prepare(sql).run(...(values as never[])).changes,
        ),
      },
    }),
  });
  const db = {
    prepare,
    batch: async (queries: { run: () => Promise<unknown> }[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const q of queries) results.push(await q.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
  sqlite.exec(
    "INSERT INTO organizations (id,name,createdAt,updatedAt) VALUES ('org','Release',1,1),('other','Other',1,1)",
  );
  for (const [user, role, org] of [
    ["ada", "owner", "org"],
    ["grace", "member", "org"],
    ["admin", "admin", "org"],
    ["outsider", "owner", "other"],
  ]) {
    sqlite
      .prepare(
        "INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)",
      )
      .run(user, user, `${user}@example.test`, 1, 1);
    sqlite
      .prepare("INSERT INTO memberships VALUES (?,?,?,?,?,?)")
      .run(user, org, user, role, 1, 1);
  }
  sqlite.exec(
    "INSERT INTO organization_teams VALUES ('release','org','Release team',1,1)",
  );
  const computers = new D1ComputerStore(db);
  const organizations = new D1OrganizationStore(db);
  const service = new ComputerService(
    computers,
    Date.now,
    "0.1.0",
    organizations,
  );
  return { sqlite, db, computers, organizations, service };
}
const input = {
  computerId: "b7ebfcbe-f2f4-4a1b-8707-3029fa65d14b",
  name: "Studio",
  icon: "laptop",
  platform: "darwin",
  daemonVersion: "1.0.0",
  protocol: { minimum: 1, maximum: 1 },
  publicKey: "k".repeat(44),
  capabilities: {
    providers: [],
    workspaces: [],
    worktrees: true,
    terminals: true,
    emulator: false,
  },
};

test("personal access grants and revokes members and teams without giving admins implicit use", async () => {
  const { sqlite, service, computers, organizations } = database();
  try {
    await service.register("org", "ada", input);
    const read = () => computers.computer("org", input.computerId);
    assert.equal((await read())!.access.mode, "owner");
    await assert.rejects(service.requireUse("org", input.computerId, "grace"));
    await assert.rejects(service.requireUse("org", input.computerId, "admin"));
    await assert.rejects(
      service.update("org", input.computerId, "admin", { name: "Take over" }),
    );
    await service.update("org", input.computerId, "ada", {
      access: { mode: "selected", userIds: ["grace"], teamIds: [] },
    });
    await service.requireUse("org", input.computerId, "grace");
    await service.update("org", input.computerId, "ada", {
      access: { mode: "selected", userIds: [], teamIds: ["release"] },
    });
    await assert.rejects(service.requireUse("org", input.computerId, "grace"));
    await organizations.addTeamMember("org", "release", "grace", Date.now());
    await service.requireUse("org", input.computerId, "grace");
    await organizations.removeTeamMember("org", "release", "grace");
    await assert.rejects(service.requireUse("org", input.computerId, "grace"));
    await assert.rejects(
      service.update("org", input.computerId, "ada", {
        access: { mode: "selected", userIds: ["outsider"], teamIds: [] },
      }),
    );
    await service.register("org", "ada", { ...input, name: "Renamed" });
    assert.equal((await read())!.access.mode, "selected");
    await service.remove("org", input.computerId, "ada");
    assert.equal(await read(), undefined);
  } finally {
    sqlite.close();
  }
});

test("organization and hosted computers have no personal owner and survive the registrar leaving", async () => {
  const { sqlite, service, computers, organizations } = database();
  try {
    await assert.rejects(
      service.register("org", "grace", { ...input, ownership: "organization" }),
    );
    for (const ownership of ["organization", "hosted"]) {
      const computerId = crypto.randomUUID();
      await service.register("org", "admin", {
        ...input,
        computerId,
        ownership,
      });
      const computer = (await computers.computer("org", computerId))!;
      assert.equal(computer.ownerUserId, null);
      assert.equal(computer.access.mode, "organization");
      await service.requireUse("org", computerId, "grace");
      await assert.rejects(service.requireUse("org", computerId, "outsider"));
      await assert.rejects(
        service.update("org", computerId, "grace", { name: "Unauthorized" }),
      );
    }
    await organizations.removeMembership("org", "admin");
    assert.equal((await computers.computers("org")).length, 2);
  } finally {
    sqlite.close();
  }
});

test("notifications address eligible participants, persist once, and honor device revocation on retry", async () => {
  const { sqlite, db, service } = database();
  try {
    await service.register("org", "ada", { ...input, capabilities: { ...input.capabilities, workspaces: [{ id: "w", name: "Release", path: "/src/release", origin: null }] } });
    await service.update("org", input.computerId, "ada", {
      access: { mode: "organization", userIds: [], teamIds: [] },
    });
    const thread = {
      id: crypto.randomUUID(),
      computerId: input.computerId,
      access: {
        organizationId: "org",
        owner: { id: "ada", label: "Ada" },
        visibility: "open",
        source: "manual",
        participants: [{ id: "grace", label: "Grace" }],
      },
      detail: { id: "thread", title: "Release", cwd: "/src/release", entries: [] },
      revision: 1,
      stale: false,
      observedAt: 1,
    } as HubThread;
    const notifications = new HubNotifications(db, async () => thread);
    const now = Date.now();
    for (const id of ["ada", "grace", "admin"]) {
      sqlite
        .prepare(
          "INSERT INTO auth_sessions(id,user_id,client_kind,client_name,access_token_hash,access_expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(id, id, "phone", "iPhone", id, now + 60000, now, now);
      sqlite
        .prepare(
          "INSERT INTO member_push_devices(id,organization_id,user_id,session_id,token,environment,name) VALUES (?,'org',?,?,?,'sandbox','iPhone')",
        )
        .run(id, id, id, id.repeat(64));
    }
    const note = {
      id: crypto.randomUUID(),
      threadId: thread.id,
      title: "Release needs you",
      message: "Review the changes.",
      highPriority: true,
      createdAt: now,
    };
    await notifications.raise("org", input.computerId, note);
    await notifications.raise("org", input.computerId, note);
    assert.equal((await notifications.list("org", "ada")).length, 1);
    assert.equal((await notifications.list("org", "grace")).length, 1);
    assert.equal((await notifications.list("org", "admin")).length, 0);
    assert.equal(
      sqlite.prepare("SELECT count(*) AS n FROM notification_pushes").get()!.n,
      2,
    );
    const sent: string[] = [];
    await notifications.deliver("org", {}, async (_c, token) => {
      sent.push(token);
      return "retry";
    });
    assert.equal(sent.length, 2);
    sqlite.exec(
      "UPDATE auth_sessions SET revoked_at=1 WHERE id='grace'; UPDATE notification_pushes SET next_attempt_at=0",
    );
    await notifications.deliver("org", {}, async (_c, token) => {
      sent.push(token);
      return "sent";
    });
    assert.equal(sent.length, 3);
    await notifications.raise("org", input.computerId, note);
    assert.equal(
      sqlite.prepare("SELECT count(*) AS n FROM notification_pushes").get()!.n,
      0,
    );
    await service.update("org", input.computerId, "ada", {
      access: { mode: "owner", userIds: [], teamIds: [] },
    });
    assert.equal((await notifications.list("org", "grace")).length, 0);
  } finally {
    sqlite.close();
  }
});

test("Apple Push signs ES256 requests and treats expired device tokens as invalid", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const der = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const config = {
    APNS_KEY: {
      get: async () =>
        `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64")}\n-----END PRIVATE KEY-----`,
    } as SecretsStoreSecret,
    APNS_KEY_ID: "key",
    APNS_TEAM_ID: "team",
    APNS_TOPIC: "me.remy.test",
  };
  const notification = {
    id: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    title: "Needs you",
    message: "Review",
    createdAt: Date.now(),
    highPriority: true,
    computerId: input.computerId,
    computerName: "Studio",
    readAt: null,
  };
  const outcome = await sendApplePush(
    config,
    "a".repeat(64),
    "sandbox",
    notification,
    "org",
    (async (url, init) => {
      assert.equal(new URL(String(url)).hostname, "api.sandbox.push.apple.com");
      const headers = new Headers(init!.headers);
      const jwt = headers.get("authorization")!.slice(7);
      const parts = jwt.split(".");
      assert.equal(
        await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          pair.publicKey,
          Buffer.from(parts[2]!, "base64url"),
          new TextEncoder().encode(parts.slice(0, 2).join(".")),
        ),
        true,
      );
      assert.equal(headers.get("apns-topic"), "me.remy.test");
      assert.equal(JSON.parse(String(init!.body)).computerId, input.computerId);
      return Response.json({ reason: "Unregistered" }, { status: 410 });
    }) as typeof fetch,
  );
  assert.equal(outcome, "invalid");
});

test("competing registrations cannot replace another member's signing key", async () => {
  const { sqlite, service, computers } = database();
  try {
    const answers = await Promise.allSettled([
      service.register("org", "ada", { ...input, publicKey: "a".repeat(44) }),
      service.register("org", "grace", { ...input, publicKey: "g".repeat(44) }),
    ]);
    assert.equal(answers.filter((a) => a.status === "fulfilled").length, 1);
    const registered = (await computers.computer("org", input.computerId))!;
    assert.equal(registered.publicKey, (registered.ownerUserId === "ada" ? "a" : "g").repeat(44));
  } finally { sqlite.close(); }
});

test("a list cursor cannot skip an update that arrives while its snapshot is being read", async () => {
  const { sqlite, db, service } = database();
  try {
    await service.register("org", "ada", { ...input, capabilities: { ...input.capabilities, workspaces: [{ id: "w", name: "Release", path: "/src/release", origin: null }] } });
    const { HubCoordinator } = await import("./worker.js");
    const values = new Map<string, unknown>([["organizationId", "org"]]);
    let afterList: (() => Promise<void>) | undefined;
    const storage = {
      getAlarm: async()=>null,
      setAlarm: async()=>{},
      get: async (key: string) => values.get(key),
      put: async (key: string, value: unknown) => { values.set(key, value); },
      delete: async (key: string) => values.delete(key),
      list: async ({ prefix }: { prefix: string }) => {
        const snapshot = new Map([...values].filter(([key]) => key.startsWith(prefix)));
        if (prefix === "threads:snapshot:" && afterList) { const run = afterList; afterList = undefined; await run(); }
        return snapshot;
      },
      transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(storage),
    };
    const coordinator = new HubCoordinator({ storage, getWebSockets: () => [], waitUntil: (work:Promise<unknown>)=>{void work;} } as unknown as DurableObjectState, { DB: db } as never);
    const threads = (coordinator as unknown as { threads: import("./thread-store.js").ThreadStore }).threads;
    const id = crypto.randomUUID();
    const snapshot = { id, revision: 1, access: { organizationId: "org", owner: { id: "ada", label: "Ada" }, visibility: "open" as const, participants: [] }, detail: { id, title: "Release", cwd: "/src/release", entries: [] } };
    await threads.snapshot(input.computerId, snapshot);
    afterList = () => threads.snapshot(input.computerId, { ...snapshot, revision: 2, detail: { ...snapshot.detail, title: "Updated release" } });
    const response = await coordinator.fetch(new Request("https://internal/threads", { headers: { "x-thread-member": encodeURIComponent(JSON.stringify({ id: "ada", label: "Ada" })), "x-organization-id": "org" } }));
    const result = await response.json() as { cursor: number; threads: HubThread[] };
    assert.equal(result.threads[0]!.revision, 1);
    const replay = await threads.replay(result.cursor);
    assert.ok(replay.frames.some((frame) => frame.kind === "snapshot" && frame.thread.revision === 2));
  } finally { sqlite.close(); }
});

test("board access follows current workspace restrictions on reads and every write", async () => {
  const { sqlite, organizations } = database();
  const { BoardAccess } = await import("./board-access.js");
  const { OrganizationService } = await import("./organizations.js");
  const service = new OrganizationService(organizations);
  const workspace = await service.createWorkspace("org", "ada", { name: "Release", origin: "https://example.test/release.git", access: { userIds: [], teamIds: ["release"] } });
  const ticket = { id: "ticket", entity: "ticket" as const, fields: { projectId: workspace.id }, activity: [], createdAt: 1, updatedAt: 1, lastActor: { kind: "member" as const, id: "ada", label: "Ada" } };
  const board = { detail: async (_entity: string, id: string) => id === "ticket" ? ticket : undefined, project: async () => undefined } as unknown as import("./organization-board.js").OrganizationBoard;
  const access = new BoardAccess(organizations, board, "org", "grace");
  try {
    assert.equal(await access.canRead(ticket), false);
    assert.equal(await access.canWrite({ entity: "ticket", entityId: "ticket", kind: "field", payload: { projectId: "", title: "Escape restriction" } }), false);
    assert.equal(await access.canWrite({ entity: "ticket", entityId: "new", kind: "create", payload: { projectId: workspace.id } }), false);
    await service.changeTeamMember("org", "ada", "release", "grace", true);
    assert.equal(await access.canRead(ticket), true);
    assert.equal(await access.canWrite({ entity: "ticket", entityId: "ticket", kind: "status", payload: { status: "done" } }), true);
    assert.equal(await access.canWrite({ entity: "ticket", entityId: "new", kind: "create", payload: { projectId: {} } }), false);
    assert.equal(await access.canWrite({ entity: "ticket", entityId: "ticket", kind: "create", payload: {} }), false);
    assert.equal(await new BoardAccess(organizations, board, "org", "outsider").canRead(ticket), false);
    await service.changeTeamMember("org", "ada", "release", "grace", false);
    assert.equal(await access.canRead(ticket), false);
    await service.removeMember("org", "ada", "grace");
    assert.equal(await access.canRead({ ...ticket, fields: {} }), false);
  } finally { sqlite.close(); }
});

test("workspace restrictions apply to capability lists and thread access including nested folders", async () => {
  const { sqlite, service, computers, organizations } = database();
  try {
    await service.register("org", "ada", { ...input, ownership: "organization", capabilities: { ...input.capabilities, workspaces: [{ id: "clone", name: "Android", path: "/src/android", origin: "git@github.com:studio/android.git" }] } });
    await organizations.createWorkspace({ id: "android", organizationId: "org", name: "Android", origin: "github.com/studio/android", restricted: true, createdAt: 1, updatedAt: 1 }, { userIds: [], teamIds: ["release"] });
    const computer = (await computers.computer("org", input.computerId))!;
    assert.equal(await service.canUseWorkspace(computer, "grace", "clone"), false);
    assert.equal((await service.list("org", "grace"))[0].capabilities.workspaces.length, 0);
    await organizations.addTeamMember("org", "release", "grace", 1);
    assert.equal(await service.canUseWorkspace(computer, "grace", "clone"), true);
    assert.equal(await service.canReadWorkspace(computer, "grace", "/src/android/subdir"), true);
    assert.equal(await service.canReadWorkspace(computer, "grace", "/src/android-other"), false);
    assert.equal(await service.canReadWorkspace(computer, "grace", undefined), false);
    await organizations.removeTeamMember("org", "release", "grace");
    assert.equal(await service.canReadWorkspace(computer, "grace", "/src/android"), false);
    assert.equal(await service.canUseWorkspace(computer, "ada", "clone"), true);
  } finally { sqlite.close(); }
});

test("hosted model keys are encrypted per organization and settings inherit explicitly",async()=>{
  const {sqlite,db}=database();const {HostedSettingsStore}=await import('./hosted-settings.js');const store=new HostedSettingsStore(db,async()=>"test-encryption-root-with-at-least-thirty-two-characters");
  try{
    await store.setSecret('org','OPENAI_API_KEY','test-private-value');
    const row=sqlite.prepare('SELECT ciphertext FROM organization_secrets WHERE organization_id=?').get('org') as {ciphertext:string};assert.ok(!row.ciphertext.includes('test-private-value'));
    assert.deepEqual(await store.secretNames('org'),['OPENAI_API_KEY']);assert.deepEqual(await store.secrets('org'),{OPENAI_API_KEY:'test-private-value'});assert.deepEqual(await store.secrets('other'),{});
    sqlite.prepare('INSERT INTO organization_secrets VALUES (?,?,?)').run('other','OPENAI_API_KEY',row.ciphertext);await assert.rejects(store.secrets('other'));
    await store.save('org','',{enabled:true,provider:'modal',cpu:2});assert.equal((await store.settings('org','w')).cpu,2);
    await store.save('org','w',{enabled:true,provider:'modal',cpu:4});assert.equal((await store.settings('org','w')).cpu,4);await store.save('org','w',null);assert.equal((await store.settings('org','w')).cpu,2);
    await store.setSecret('org','OPENAI_API_KEY',null);assert.deepEqual(await store.secretNames('org'),[]);
  }finally{sqlite.close();}
});

 test("cloud connections enable independently and placement uses an enabled provider", async () => {
  const {sqlite,db}=database();
  const {HostedSettingsStore}=await import('./hosted-settings.js');
  const store=new HostedSettingsStore(db,async()=>"test-encryption-root-with-at-least-thirty-two-characters");
  const fly={provider:'fly-sprites',enabled:true,token:'private-fly-token'};
  const modal={provider:'modal',enabled:true,tokenId:'private-modal-id',tokenSecret:'private-modal-secret'};
  try {
    await store.setSecret('org','cloud:fly-sprites',JSON.stringify(fly));
    await store.setSecret('org','cloud:modal',JSON.stringify(modal));
    assert.deepEqual((await store.enabledProviders('org')).sort(),['fly-sprites','modal']);
    assert.deepEqual(await store.enabledProviders('other'),[]);
    await store.save('org','',{enabled:true,provider:'modal'});
    assert.equal((await store.executionSettings('org','w')).provider,'modal');
    await store.setSecret('org','cloud:modal',JSON.stringify({...modal,enabled:false}));
    assert.deepEqual(await store.enabledProviders('org'),['fly-sprites']);
    assert.equal((await store.executionSettings('org','w')).provider,'fly-sprites');
    await store.setSecret('org','cloud:fly-sprites',JSON.stringify({...fly,enabled:false}));
    await assert.rejects(store.executionSettings('org','w'),/Enable a cloud provider/);
    await store.setSecret('org','cloud:modal',JSON.stringify(modal));
    assert.deepEqual(await store.enabledProviders('org'),['modal']);
    assert.equal((await store.executionSettings('org','w')).provider,'modal');
  } finally {sqlite.close();}
});

test("OpenRouter routes enforce admin access and persist only encrypted credentials", async () => {
  const {sqlite, db} = database();
  const {createRouteHandler} = await import("./worker.js");
  const {HostedSettingsStore} = await import("./hosted-settings.js");
  let role = "owner", clientKind = "web", resets = 0;
  const secret = "test-encryption-root-with-at-least-thirty-two-characters";
  const route = createRouteHandler({
    accountStore: () => ({}) as never,
    accountService: () => ({authenticate: async () => ({userId:"user",sessionId:"session",clientKind})}) as never,
    organizationStore: () => ({}) as never,
    organizationService: () => ({member: async () => ({role})}) as never,
  });
  const env = {DB:db, AUTH_SECRET:{get:async () => secret}, BETTER_AUTH_URL:"https://hub.example", COORDINATOR:{idFromName:()=>({}),get:()=>({fetch:async()=>{resets++;return Response.json({ok:true});}})}} as never;
  const call = (path:string, method:string, input?:unknown, origin="https://hub.example") => route(new Request(`https://hub.example/api/organizations/org/${path}`, {method,headers:{authorization:"Bearer test",origin,"content-type":"application/json"},...(input ? {body:JSON.stringify(input)} : {})}),env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url:unknown) => {
    assert.equal(url,"https://openrouter.ai/api/v1/models/user");
    return Response.json({data:[{id:"vendor/model"}]});
  }) as typeof fetch;
  try {
    const input = {apiKey:"openrouter-private-test",model:"vendor/model"};
    assert.equal((await call("openrouter-models","PUT",input)).status,405);
    role="member";
    assert.equal((await call("openrouter-connection","PUT",input)).status,403);
    role="owner";clientKind="computer";
    assert.equal((await call("openrouter-connection","PUT",input)).status,403);
    clientKind="web";
    assert.equal((await call("openrouter-connection","PUT",input,"https://foreign.example")).status,403);
    assert.equal((await call("openrouter-connection","PUT",{...input,model:"missing"})).status,400);
    assert.deepEqual(await (await call("openrouter-models","POST",{apiKey:input.apiKey})).json(),{models:["vendor/model"]});
    assert.equal((await call("openrouter-connection","PUT",input)).status,200);
    const store = new HostedSettingsStore(db,async()=>secret);
    assert.deepEqual(await store.secretNames("org"),["model:openrouter"]);
    assert.deepEqual(JSON.parse((await store.secrets("org"))["model:openrouter"]),input);
    assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM organization_secrets").all()).includes(input.apiKey));
    const read = await (await call("hosted","GET")).json() as {openrouterConfigured:boolean};
    assert.equal(read.openrouterConfigured,true);
    assert.ok(!JSON.stringify(read).includes(input.apiKey));
    assert.equal((await call("openrouter-connection","DELETE")).status,200);
    assert.deepEqual(await store.secretNames("org"),[]);
    assert.equal(resets,2);
    role="member";
    assert.equal((await call("model-access/openrouter","PATCH",{enabled:true,apiKey:input.apiKey})).status,403);
    role="owner";clientKind="computer";
    assert.equal((await call("model-access/openrouter","PATCH",{enabled:true,apiKey:input.apiKey})).status,403);
    clientKind="web";
    assert.equal((await call("model-access/openrouter","PATCH",{enabled:true,apiKey:input.apiKey},"https://foreign.example")).status,403);
    assert.equal((await call("model-access/openrouter","PATCH",{enabled:true,apiKey:input.apiKey})).status,200);
    assert.equal((await call("model-access/openrouter","PATCH",{enabled:false})).status,200);
    const access=await (await call("model-access","GET")).json() as {providers:{id:string;configured:boolean;enabled:boolean}[]};
    assert.equal(access.providers.find(p=>p.id==="openrouter")?.configured,true);
    assert.equal(access.providers.find(p=>p.id==="openrouter")?.enabled,false);
    assert.ok(!JSON.stringify(access).includes(input.apiKey));
  } finally {globalThis.fetch=originalFetch;sqlite.close();}
});

test("model access toggles preserve encrypted keys and expose only enabled models to execution",async()=>{
  const {sqlite,db}=database();
  const {HostedSettingsStore}=await import("./hosted-settings.js");
  const {saveModelAccess,publicModelAccess,modelEnvironment}=await import("./model-access.js");
  const store=new HostedSettingsStore(db,async()=>"test-encryption-root-with-at-least-thirty-two-characters");
  const before=globalThis.fetch;
  globalThis.fetch=(async()=>Response.json({data:[{id:"vendor/model"}]})) as typeof fetch;
  try {
    await saveModelAccess(store,"org","openrouter",{enabled:true,apiKey:"private-openrouter-key"});
    await saveModelAccess(store,"org","router",{enabled:true,apiKey:"private-router-key"});
    await saveModelAccess(store,"org","openai",{enabled:true,apiKey:"private-openai-key"});
    let secrets=await store.secrets("org");
    assert.ok(modelEnvironment(secrets).OPENROUTER_API_KEY);
    assert.ok(modelEnvironment(secrets).RAMP_ROUTER_API_KEY);
    assert.ok(modelEnvironment(secrets).OPENAI_API_KEY);
    await saveModelAccess(store,"org","openrouter",{enabled:false});
    secrets=await store.secrets("org");
    assert.equal(modelEnvironment(secrets).OPENROUTER_API_KEY,undefined);
    assert.equal(JSON.parse(secrets["access:openrouter"]).apiKey,"private-openrouter-key");
    assert.deepEqual(publicModelAccess(secrets).find(p=>p.id==="openrouter"),{id:"openrouter",enabled:false,configured:true,models:["vendor/model"]});
    assert.ok(!JSON.stringify(publicModelAccess(secrets)).includes("private-"));
    await saveModelAccess(store,"org","openrouter",{enabled:true});
    assert.equal(modelEnvironment(await store.secrets("org")).OPENROUTER_API_KEY,"private-openrouter-key");
    assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM organization_secrets").all()).includes("private-"));
    assert.deepEqual(await store.secrets("other"),{});
  }finally{globalThis.fetch=before;sqlite.close();}
});
