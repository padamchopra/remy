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

test("a personal computer grant gives every organization member use without management or key access", async () => {
  const { sqlite, service } = database();
  const computerId = crypto.randomUUID();
  try {
    sqlite.exec("INSERT INTO organizations(id,name,createdAt,updatedAt,personal_owner_id) VALUES('personal','Personal',1,1,'ada'); INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('personal-ada','personal','ada','owner',1,1)");
    await service.register("personal", "ada", { ...input, computerId, capabilities: { ...input.capabilities, workspaces: [{ id: "private", name: "Private", path: "/private", origin: "github.com/ada/private" }, { id: "release", name: "Release", path: "/release", origin: "github.com/example/release" }] } });
    sqlite.prepare("INSERT INTO organization_computer_shares(organization_id,source_organization_id,computer_id,shared_by,created_at) VALUES(?,?,?,?,?)").run("org", "personal", computerId, "ada", 1);
    sqlite.prepare("INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("org-release", "org", "Release", "github.com/example/release", 1, 1);
    const memberView = await service.list("org", "grace");
    assert.equal(memberView.length, 1);
    assert.equal(memberView[0].organizationId, "org");
    assert.equal(memberView[0].canUse, true);
    assert.equal(memberView[0].canManage, false);
    assert.equal(memberView[0].shared, true);
    assert.equal(memberView[0].access.mode, "organization");
    assert.deepEqual(memberView[0].capabilities.workspaces.map(workspace => workspace.id), ["release"]);
    assert.equal("publicKey" in memberView[0], false);
    await service.requireUse("org", computerId, "grace");
    await assert.rejects(service.update("org", computerId, "ada", { name: "Changed through the organization" }));
    sqlite.prepare("DELETE FROM organization_computer_shares WHERE organization_id=? AND computer_id=?").run("org", computerId);
    assert.deepEqual(await service.list("org", "grace"), []);
  } finally {
    sqlite.close();
  }
});

test("organization computer settings share only an admin's personal connections and never return credentials", async () => {
  const { sqlite, db, computers, organizations, service: computerService } = database();
  const { createRouteHandler } = await import("./worker.js");
  const { OrganizationService } = await import("./organizations.js");
  const { personalSpace } = await import("./personal-space.js");
  const { HostedSettingsStore } = await import("./hosted-settings.js");
  let userId = "ada";
  try {
    const personal = await personalSpace(db, userId);
    const computerId = crypto.randomUUID();
    await computerService.register(personal.id, userId, { ...input, computerId });
    const settings = new HostedSettingsStore(db, async () => "test-encryption-root-with-at-least-thirty-two-characters");
    await settings.setSecret(personal.id, "cloud:modal", JSON.stringify({ provider: "modal", enabled: true, tokenId: "private-id", tokenSecret: "private-secret" }));
    const route = createRouteHandler({
      accountService: () => ({ authenticate: async () => ({ userId, sessionId: "session", clientKind: "web" }) }) as never,
      computerStore: () => computers,
      organizationStore: () => organizations,
      organizationService: () => new OrganizationService(organizations),
    });
    const env = { DB: db, AUTH_SECRET: { get: async () => "test-encryption-root-with-at-least-thirty-two-characters" }, BETTER_AUTH_URL: "https://hub.example", COORDINATOR: { idFromName: (id:string) => id, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } } as never;
    const call = (path: string, method = "GET") => route(new Request(`https://hub.example/api/organizations/org/${path}`, { method, headers: { authorization: "Bearer session", origin: "https://hub.example" } }), env);
    assert.equal((await call(`compute-shares/computers/${computerId}`, "PUT")).status, 200);
    assert.equal((await call("compute-shares/cloud/modal", "PUT")).status, 200);
    const response = await call("compute-shares");
    assert.equal(response.status, 200);
    const payload = await response.json() as { computers: {id:string;shared:boolean}[]; cloudConnections:{provider:string;shared:boolean}[] };
    assert.ok(payload.computers.some(computer => computer.id === computerId && computer.shared));
    assert.ok(payload.cloudConnections.some(connection => connection.provider === "modal" && connection.shared));
    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes("private-id"), false);
    assert.equal(serialized.includes("private-secret"), false);
    assert.equal(serialized.includes("publicKey"), false);
    userId = "grace";
    assert.equal((await call(`compute-shares/computers/${computerId}`, "PUT")).status, 404);
    assert.equal((await call(`compute-shares/computers/${computerId}`, "DELETE")).status, 403);
    assert.equal((await computerService.requireUse("org", computerId, "grace")).computerId, computerId);
    userId = "ada";
    assert.equal((await call(`compute-shares/computers/${computerId}`, "DELETE")).status, 200);
    await assert.rejects(computerService.requireUse("org", computerId, "grace"), /not available/);
  } finally {
    sqlite.close();
  }
});

test("members share their own computers and start-provider grants block only new threads", async () => {
  const { sqlite, db, computers, organizations, service: computerService } = database();
  const { createRouteHandler, HubCoordinator } = await import("./worker.js");
  const { OrganizationService } = await import("./organizations.js");
  const { personalSpace } = await import("./personal-space.js");
  const { START_PROVIDER_DENIED } = await import("./computer-start-access.js");
  let userId = "grace";
  try {
    const personal = await personalSpace(db, userId);
    const computerId = crypto.randomUUID();
    await computerService.register(personal.id, userId, {
      ...input,
      computerId,
      capabilities: {
        ...input.capabilities,
        providers: [
          { id: "claude", models: [""] },
          { id: "cursor", models: [""] },
        ],
        workspaces: [{ id: "release", name: "Release", path: "/src/release", origin: "github.com/example/release" }],
      },
    });
    await computers.seen(personal.id, computerId, Date.now(), undefined, undefined);
    sqlite.prepare("INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("org-release", "org", "Release", "github.com/example/release", 1, 1);
    const route = createRouteHandler({
      accountService: () => ({ authenticate: async () => ({ userId, sessionId: "session", clientKind: "web" }) }) as never,
      computerStore: () => computers,
      organizationStore: () => organizations,
      organizationService: () => new OrganizationService(organizations),
    });
    const env = { DB: db, AUTH_SECRET: { get: async () => "test-encryption-root-with-at-least-thirty-two-characters" }, BETTER_AUTH_URL: "https://hub.example", COORDINATOR: { idFromName: (id:string) => id, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } } as never;
    const call = (path: string, method = "GET", payload?: unknown) => route(new Request(`https://hub.example/api/organizations/org/${path}`, { method, headers: { authorization: "Bearer session", origin: "https://hub.example", "content-type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }), env);

    assert.equal((await call(`compute-shares/computers/${input.computerId}`, "PUT")).status, 404);
    assert.equal((await call(`compute-shares/computers/${computerId}`, "PUT")).status, 200);
    const shared = await (await call("compute-shares")).json() as { computers: { id: string; shared: boolean; canShare: boolean; canRevoke: boolean; providers: { id: string; allowed: boolean; label: string }[] }[] };
    const row = shared.computers.find(computer => computer.id === computerId)!;
    assert.equal(row.shared, true);
    assert.equal(row.canShare, true);
    assert.equal(row.canRevoke, false);
    assert.deepEqual(row.providers, [
      { id: "claude", label: "Claude", allowed: true },
      { id: "cursor", label: "Cursor", allowed: true },
    ]);
    assert.equal((await call(`compute-shares/computers/${computerId}`, "PATCH", { startProviders: ["claude"] })).status, 200);
    assert.equal((await call(`compute-shares/computers/${computerId}`, "PATCH", { startProviders: ["codex"] })).status, 400);

    userId = "ada";
    const adminView = await (await call("compute-shares")).json() as { computers: { id: string; canShare: boolean; canRevoke: boolean; providers: { id: string; allowed: boolean; label: string }[] }[] };
    const adminRow = adminView.computers.find(computer => computer.id === computerId)!;
    assert.equal(adminRow.canShare, false);
    assert.equal(adminRow.canRevoke, true);
    assert.deepEqual(adminRow.providers.find(provider => provider.id === "cursor"), { id: "cursor", label: "Cursor", allowed: false });
    assert.equal((await call(`compute-shares/computers/${computerId}`, "PATCH", { startProviders: ["claude", "cursor"] })).status, 404);

    const memberList = await computerService.list("org", "ada");
    assert.deepEqual(memberList[0]?.capabilities.providers.map(provider => provider.id), ["claude"]);
    const ownerList = await computerService.list("org", "grace");
    assert.deepEqual(ownerList[0]?.capabilities.providers.map(provider => provider.id), ["claude", "cursor"]);
    const stored = (await computers.computer("org", computerId))!;
    assert.equal(await computerService.canStartWithProvider(stored, "grace", "org", "cursor"), true);
    assert.equal(await computerService.canStartWithProvider(stored, "ada", "org", "cursor"), false);
    assert.equal(await computerService.canStartWithProvider(stored, "ada", "org", "claude"), true);

    const values = new Map<string, unknown>([["organizationId", "org"]]);
    const coordinator = new HubCoordinator({ storage: { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value); }, delete: async (key: string) => values.delete(key), list: async () => new Map(), getAlarm: async () => null, setAlarm: async () => {}, transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value); } }) }, getWebSockets: () => [], waitUntil: (work: Promise<unknown>) => { void work; } } as unknown as DurableObjectState, { DB: db, AUTH_SECRET: { get: async () => "test-encryption-root-with-at-least-thirty-two-characters" }, BETTER_AUTH_URL: "https://hub.example" } as never);
    const forwarded: unknown[][] = [];
    const threadId = crypto.randomUUID();
    (coordinator as unknown as { dispatchComputer: (...args: unknown[]) => Promise<Response> }).dispatchComputer = async (...args) => {
      forwarded.push(args);
      return Response.json({ id: threadId, revision: 1, access: { organizationId: "org", owner: { id: "grace", label: "Grace" }, visibility: "open", participants: [{ id: "ada", label: "Ada" }] }, detail: { id: threadId, title: "Release", cwd: "/src/release", entries: [] } });
    };
    const request = (user: string, path: string, method: string, payload: unknown) => new Request(`https://internal${path}`, { method, headers: { "content-type": "application/json", "x-thread-member": encodeURIComponent(JSON.stringify({ id: user, label: user })), "x-organization-id": "org" }, body: JSON.stringify(payload) });
    const handle = (coordinator as unknown as { threadRequest: (r: Request) => Promise<Response | undefined> }).threadRequest.bind(coordinator);
    const denied = await handle(request("ada", "/threads", "POST", { workspaceId: "org-release", requestId: crypto.randomUUID(), computerId, provider: "cursor", visibility: "open" }));
    assert.equal(denied?.status, 403);
    assert.equal((await denied!.json() as { error: string }).error, START_PROVIDER_DENIED);
    const ownerStart = await handle(request("grace", "/threads", "POST", { workspaceId: "org-release", requestId: crypto.randomUUID(), computerId, provider: "cursor", visibility: "open" }));
    assert.equal(ownerStart?.status, 202);
    assert.equal((await ownerStart!.json() as { phase?: string }).phase, "creating");
    const threads = (coordinator as unknown as { threads: import("./thread-store.js").ThreadStore }).threads;
    await threads.snapshot(computerId, { id: threadId, revision: 1, access: { organizationId: "org", owner: { id: "grace", label: "Grace" }, visibility: "open", participants: [{ id: "ada", label: "Ada" }] }, detail: { id: threadId, title: "Release", cwd: "/src/release", entries: [] } });
    const replied = await handle(request("ada", `/computers/${computerId}/threads/${threadId}/message`, "POST", { text: "Continue this thread.", messageId: `u-${crypto.randomUUID()}` }));
    assert.equal(replied?.status, 200);
    assert.equal((await replied!.json() as { error?: string }).error, undefined);
    assert.ok(forwarded.some(entry => String(entry[3]).includes("/message")));

    userId = "ada";
    assert.equal((await call(`compute-shares/computers/${computerId}`, "DELETE")).status, 200);
    userId = "grace";
    assert.equal((await call(`compute-shares/computers/${computerId}`, "PUT")).status, 200);
    assert.equal((await call(`compute-shares/computers/${computerId}`, "DELETE")).status, 200);
    assert.equal((await (await call("compute-shares")).json() as { computers: { id: string; shared: boolean }[] }).computers.some(computer => computer.id === computerId && computer.shared), false);
  } finally {
    sqlite.close();
  }
});

test("members share their own cloud connections and start-provider grants block only new threads", async () => {
  const { sqlite, db, computers, organizations, service: computerService } = database();
  const { createRouteHandler, HubCoordinator } = await import("./worker.js");
  const { OrganizationService } = await import("./organizations.js");
  const { personalSpace } = await import("./personal-space.js");
  const { HostedSettingsStore } = await import("./hosted-settings.js");
  const { saveModelAccess } = await import("./model-access.js");
  const { START_PROVIDER_DENIED } = await import("./computer-start-access.js");
  let userId = "grace";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ data: [{ id: "openrouter/auto" }] })) as typeof fetch;
  try {
    const personal = await personalSpace(db, userId);
    const settings = new HostedSettingsStore(db, async () => "test-encryption-root-with-at-least-thirty-two-characters");
    await settings.setSecret(personal.id, "cloud:modal", JSON.stringify({ provider: "modal", enabled: true, tokenId: "private-id", tokenSecret: "private-secret" }));
    await saveModelAccess(settings, personal.id, "anthropic", { enabled: true, apiKey: "grace-anthropic" });
    await saveModelAccess(settings, personal.id, "openrouter", { enabled: true, apiKey: "grace-openrouter" });
    sqlite.prepare("INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("org-release", "org", "Release", "github.com/example/release", 1, 1);
    const hostedId = crypto.randomUUID();
    await computerService.register("org", "ada", {
      ...input,
      computerId: hostedId,
      ownership: "hosted",
      name: "Cloud task",
      icon: "cloud",
      platform: "linux",
      capabilities: {
        ...input.capabilities,
        workspaces: [{ id: "org-release", name: "Release", path: "/workspace", origin: "github.com/example/release" }],
      },
    });
    await computers.seen("org", hostedId, Date.now(), undefined, undefined);
    const route = createRouteHandler({
      accountService: () => ({ authenticate: async () => ({ userId, sessionId: "session", clientKind: "web" }) }) as never,
      computerStore: () => computers,
      organizationStore: () => organizations,
      organizationService: () => new OrganizationService(organizations),
    });
    const env = { DB: db, AUTH_SECRET: { get: async () => "test-encryption-root-with-at-least-thirty-two-characters" }, BETTER_AUTH_URL: "https://hub.example", COORDINATOR: { idFromName: (id:string) => id, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } } as never;
    const call = (path: string, method = "GET", payload?: unknown) => route(new Request(`https://hub.example/api/organizations/org/${path}`, { method, headers: { authorization: "Bearer session", origin: "https://hub.example", "content-type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }), env);

    userId = "ada";
    assert.equal((await call("compute-shares/cloud/modal", "PUT")).status, 409);
    userId = "grace";
    assert.equal((await call("compute-shares/cloud/modal", "PUT")).status, 200);
    const shared = await (await call("compute-shares")).json() as { cloudConnections: { provider: string; shared: boolean; canShare: boolean; canRevoke: boolean; providers: { id: string; allowed: boolean; label: string }[] }[] };
    const row = shared.cloudConnections.find(connection => connection.provider === "modal")!;
    assert.equal(row.shared, true);
    assert.equal(row.canShare, true);
    assert.equal(row.canRevoke, false);
    assert.deepEqual(row.providers, [
      { id: "anthropic", label: "Anthropic", allowed: true },
      { id: "openrouter", label: "OpenRouter", allowed: true },
    ]);
    assert.equal(row.providers.some(provider => provider.id === "codex"), false);
    assert.equal((await call("compute-shares/cloud/modal", "PATCH", { startProviders: ["anthropic"] })).status, 200);
    assert.equal((await call("compute-shares/cloud/modal", "PATCH", { startProviders: ["cursor"] })).status, 400);

    userId = "ada";
    const adminView = await (await call("compute-shares")).json() as { cloudConnections: { provider: string; canShare: boolean; canRevoke: boolean; providers: { id: string; allowed: boolean; label: string }[] }[] };
    const adminRow = adminView.cloudConnections.find(connection => connection.provider === "modal")!;
    assert.equal(adminRow.canShare, false);
    assert.equal(adminRow.canRevoke, true);
    assert.deepEqual(adminRow.providers.find(provider => provider.id === "openrouter"), { id: "openrouter", allowed: false, label: "OpenRouter" });
    assert.equal(adminRow.providers.some(provider => provider.id === "codex"), false);
    assert.equal((await call("compute-shares/cloud/modal", "PATCH", { startProviders: ["anthropic", "openrouter"] })).status, 404);

    const hosted = await (await call("hosted")).json() as { enabledProviders: string[]; cloudStart: Record<string, { owner: boolean; providers: { id: string; allowed: boolean }[] }> };
    assert.deepEqual(hosted.enabledProviders, ["modal"]);
    assert.equal(hosted.cloudStart.modal.owner, false);
    assert.equal(hosted.cloudStart.modal.providers.find(provider => provider.id === "openrouter")?.allowed, false);
    assert.equal(hosted.cloudStart.modal.providers.some(provider => provider.id === "codex"), false);

    const values = new Map<string, unknown>([["organizationId", "org"]]);
    const coordinator = new HubCoordinator({ storage: { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value); }, delete: async (key: string) => values.delete(key), list: async () => new Map(), getAlarm: async () => null, setAlarm: async () => {}, transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value); } }) }, getWebSockets: () => [], waitUntil: (work: Promise<unknown>) => { void work; } } as unknown as DurableObjectState, { DB: db, AUTH_SECRET: { get: async () => "test-encryption-root-with-at-least-thirty-two-characters" }, BETTER_AUTH_URL: "https://hub.example" } as never);
    const forwarded: unknown[][] = [];
    const threadId = crypto.randomUUID();
    (coordinator as unknown as { dispatchComputer: (...args: unknown[]) => Promise<Response> }).dispatchComputer = async (...args) => {
      forwarded.push(args);
      return Response.json({ id: threadId, revision: 1, access: { organizationId: "org", owner: { id: "grace", label: "Grace" }, visibility: "open", participants: [{ id: "ada", label: "Ada" }] }, detail: { id: threadId, title: "Release", cwd: "/workspace", entries: [] } });
    };
    const request = (user: string, path: string, method: string, payload: unknown) => new Request(`https://internal${path}`, { method, headers: { "content-type": "application/json", "x-thread-member": encodeURIComponent(JSON.stringify({ id: user, label: user })), "x-organization-id": "org" }, body: JSON.stringify(payload) });
    const handle = (coordinator as unknown as { threadRequest: (r: Request) => Promise<Response | undefined> }).threadRequest.bind(coordinator);
    const denied = await handle(request("ada", "/threads", "POST", { workspaceId: "org-release", requestId: crypto.randomUUID(), computerId: "cloud:modal", provider: "openrouter", model: "openrouter/auto", visibility: "open" }));
    assert.equal(denied?.status, 403);
    assert.equal((await denied!.json() as { error: string }).error, START_PROVIDER_DENIED);
    const ownerStart = await handle(request("grace", "/threads", "POST", { workspaceId: "org-release", requestId: crypto.randomUUID(), computerId: "cloud:modal", provider: "openrouter", model: "openrouter/auto", visibility: "open" }));
    assert.notEqual(ownerStart?.status, 403);
    const threads = (coordinator as unknown as { threads: import("./thread-store.js").ThreadStore }).threads;
    await threads.snapshot(hostedId, { id: threadId, revision: 1, access: { organizationId: "org", owner: { id: "grace", label: "Grace" }, visibility: "open", participants: [{ id: "ada", label: "Ada" }] }, detail: { id: threadId, title: "Release", cwd: "/workspace", entries: [] } });
    const replied = await handle(request("ada", `/computers/${hostedId}/threads/${threadId}/message`, "POST", { text: "Continue this thread.", messageId: `u-${crypto.randomUUID()}` }));
    assert.equal(replied?.status, 200);
    assert.ok(forwarded.some(entry => String(entry[3]).includes("/message")));

    userId = "ada";
    assert.equal((await call("compute-shares/cloud/modal", "DELETE")).status, 200);
    userId = "grace";
    assert.equal((await (await call("compute-shares")).json() as { cloudConnections: { provider: string; shared: boolean }[] }).cloudConnections.some(connection => connection.provider === "modal" && connection.shared), false);
    assert.equal((await call("compute-shares/cloud/modal", "PUT")).status, 200);
    assert.equal((await call("compute-shares/cloud/modal", "DELETE")).status, 200);
  } finally {
    globalThis.fetch = originalFetch;
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
  const {saveModelAccess,publicModelAccess,hostedGatewayError,modelEnvironment}=await import('./model-access.js');
  const store=new HostedSettingsStore(db,async()=>"test-encryption-root-with-at-least-thirty-two-characters");
  const before=globalThis.fetch;
  globalThis.fetch=(async()=>Response.json({data:[{id:"openrouter/auto"}]})) as typeof fetch;
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
    sqlite.prepare("INSERT INTO organization_cloud_shares(organization_id,source_organization_id,provider,shared_by,created_at) VALUES(?,?,?,?,?)").run('other','org','modal','outsider',1);
    assert.deepEqual(await store.enabledProviders('other'),['modal']);
    assert.deepEqual(await store.connection('other','modal'),modal);
    assert.deepEqual(await store.secretNames('other'),[]);
    await saveModelAccess(store,"org","openrouter",{enabled:true,apiKey:"source-openrouter-key"});
    const sharedAccess = publicModelAccess(await store.executionSecrets("other"), await store.secrets("other"));
    assert.equal(sharedAccess.find(entry => entry.id === "openrouter")?.enabled, true);
    assert.equal(sharedAccess.find(entry => entry.id === "openrouter")?.configured, true);
    assert.deepEqual(sharedAccess.find(entry => entry.id === "openrouter")?.keys, []);
    assert.equal(hostedGatewayError("openrouter", "openrouter/auto", await store.executionSecrets("other")), undefined);
    assert.equal(modelEnvironment(await store.executionSecrets("other")).OPENROUTER_API_KEY, "source-openrouter-key");
    assert.equal("cloud:modal" in (await store.executionSecrets("other")), false);
    await saveModelAccess(store,"other","openrouter",{enabled:false,apiKey:"org-openrouter-key"});
    assert.equal(publicModelAccess(await store.executionSecrets("other")).find(entry => entry.id === "openrouter")?.enabled, false);
    assert.equal(hostedGatewayError("openrouter", "openrouter/auto", await store.executionSecrets("other")), "Choose an enabled provider and model.");
    assert.equal(modelEnvironment(await store.executionSecrets("other")).OPENROUTER_API_KEY, undefined);
  } finally {globalThis.fetch=before;sqlite.close();}
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
    sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('user','User','user@example.test',1,1); INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('team','Team',1,1); INSERT INTO memberships VALUES('team-user','team','user','member',1,1)");
    await store.setSecret("org","cloud:fly-sprites",JSON.stringify({provider:"fly-sprites",enabled:true,token:"private-fly-token"}));
    sqlite.prepare("INSERT INTO organization_cloud_shares(organization_id,source_organization_id,provider,shared_by,created_at) VALUES(?,?,?,?,?)").run("team","org","fly-sprites","user",1);
    role="owner";
    assert.equal((await call("model-access/openrouter","PATCH",{enabled:true})).status,200);
    const teamCall = (path:string) => route(new Request(`https://hub.example/api/organizations/team/${path}`, {headers:{authorization:"Bearer test",origin:"https://hub.example"}}),env);
    role="member";
    const teamAccess=await (await teamCall("model-access")).json() as {providers:{id:string;configured:boolean;enabled:boolean}[]};
    assert.equal(teamAccess.providers.find(p=>p.id==="openrouter")?.enabled,true);
    assert.equal(teamAccess.providers.find(p=>p.id==="openrouter")?.configured,true);
    assert.ok(!JSON.stringify(teamAccess).includes(input.apiKey));
    const hosted=await (await teamCall("hosted")).json() as {enabledProviders:string[];connections:string[];openrouterConfigured:boolean};
    assert.deepEqual(hosted.enabledProviders,["fly-sprites"]);
    assert.equal(hosted.connections.includes("fly-sprites"), false);
    assert.equal(hosted.openrouterConfigured,true);
  } finally {globalThis.fetch=originalFetch;sqlite.close();}
});

test("named Fly.io and OpenRouter keys stay encrypted and unused by computers", async () => {
  const {sqlite, db} = database();
  const {createRouteHandler} = await import("./worker.js");
  const {HostedSettingsStore} = await import("./hosted-settings.js");
  const {modelEnvironment} = await import("./model-access.js");
  let role = "owner", clientKind = "web";
  const secret = "test-encryption-root-with-at-least-thirty-two-characters";
  const route = createRouteHandler({
    accountStore: () => ({}) as never,
    accountService: () => ({authenticate: async () => ({userId:"user",sessionId:"session",clientKind})}) as never,
    organizationStore: () => ({}) as never,
    organizationService: () => ({member: async () => ({role})}) as never,
  });
  const env = {DB:db, AUTH_SECRET:{get:async () => secret}, BETTER_AUTH_URL:"https://hub.example", COORDINATOR:{idFromName:()=>({}),get:()=>({fetch:async()=>Response.json({ok:true})})}} as never;
  const call = (path:string, method="GET", input?:unknown, origin="https://hub.example") => route(new Request(`https://hub.example/api/organizations/org/${path}`, {method,headers:{authorization:"Bearer test",origin,"content-type":"application/json"},...(input ? {body:JSON.stringify(input)} : {})}),env);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({data:[{id:"vendor/model"}]})) as typeof fetch;
  try {
    role="member";
    assert.equal((await call("cloud-connection/keys","POST",{provider:"fly-sprites",name:"Production",token:"fly-one"})).status,403);
    role="owner";clientKind="computer";
    assert.equal((await call("cloud-connection/keys","POST",{provider:"fly-sprites",name:"Production",token:"fly-one"})).status,403);
    assert.equal((await call("model-access/openrouter/keys","POST",{name:"Primary",apiKey:"openrouter-one"})).status,403);
    clientKind="web";
    assert.equal((await call("cloud-connection/keys","POST",{provider:"fly-sprites",name:"Production",token:"fly-one"})).status,200);
    assert.equal((await call("cloud-connection/keys","POST",{provider:"fly-sprites",name:"Preview",token:"fly-two"})).status,200);
    assert.equal((await call("model-access/openrouter/keys","POST",{name:"Primary",apiKey:"openrouter-one"})).status,200);
    assert.equal((await call("model-access/openrouter/keys","POST",{name:"Team",apiKey:"openrouter-two"})).status,200);
    const first = await (await call("model-access")).json() as {providers:{id:string;keys:{id:string;name:string}[]}[]};
    const teamKey = first.providers.find(entry => entry.id === "openrouter")?.keys.find(key => key.name === "Team");
    assert.ok(teamKey);
    assert.equal((await call(`model-access/openrouter/keys/${teamKey.id}`,"PATCH",{active:true})).status,200);
    const hosted = await (await call("hosted")).json() as {providerKeys:{["fly-sprites"]: {id:string;name:string;active:boolean}[]};connections:string[]};
    assert.deepEqual(hosted.providerKeys["fly-sprites"].map(key => key.name).sort(),["Preview","Production"]);
    assert.ok(!JSON.stringify(hosted).includes("fly-one"));
    assert.ok(!JSON.stringify(hosted).includes("fly-two"));
    const access = await (await call("model-access")).json() as {providers:{id:string;configured:boolean;keys:{name:string;active:boolean}[]}[]};
    const openrouter = access.providers.find(entry => entry.id === "openrouter")!;
    assert.equal(openrouter.configured, true);
    assert.deepEqual(openrouter.keys.map(key => key.name).sort(), ["Primary","Team"]);
    assert.equal(openrouter.keys.find(key => key.name === "Team")?.active, true);
    assert.ok(!JSON.stringify(access).includes("openrouter-one"));
    assert.ok(!JSON.stringify(access).includes("openrouter-two"));
    const store = new HostedSettingsStore(db, async () => secret);
    const secrets = await store.secrets("org");
    assert.equal(JSON.parse(secrets["cloud:fly-sprites"]).token, "fly-one");
    assert.equal(modelEnvironment(secrets).OPENROUTER_API_KEY, "openrouter-two");
    assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM organization_secrets").all()).includes("fly-one"));
    assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM organization_secrets").all()).includes("openrouter-two"));
    const preview = hosted.providerKeys["fly-sprites"].find(key => key.name === "Preview")!;
    assert.equal((await call(`cloud-connection/keys/${preview.id}`,"PATCH",{provider:"fly-sprites",active:true})).status,200);
    assert.equal(JSON.parse((await store.secrets("org"))["cloud:fly-sprites"]).token, "fly-two");
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
    assert.deepEqual(publicModelAccess(secrets).find(p=>p.id==="openrouter"),{id:"openrouter",enabled:false,configured:true,models:["vendor/model"],keys:[{id:"legacy",name:"Default",active:true}]});
    assert.ok(!JSON.stringify(publicModelAccess(secrets)).includes("private-"));
    await saveModelAccess(store,"org","openrouter",{enabled:true});
    assert.equal(modelEnvironment(await store.secrets("org")).OPENROUTER_API_KEY,"private-openrouter-key");
    assert.ok(!JSON.stringify(sqlite.prepare("SELECT * FROM organization_secrets").all()).includes("private-"));
    assert.deepEqual(await store.secrets("other"),{});
  }finally{globalThis.fetch=before;sqlite.close();}
});

test("branch reads only forward an authorized workspace and never neighboring actions", async () => {
  const { sqlite, db, service } = database();
  try {
    await service.register("org", "ada", { ...input, capabilities: { ...input.capabilities, workspaces: [{ id: "w", name: "Release", path: "/src/release", origin: null }] } });
    const { HubCoordinator } = await import("./worker.js");
    const coordinator = new HubCoordinator({ storage: {get: async()=>"org"}, getWebSockets:()=>[] } as unknown as DurableObjectState, { DB: db } as never);
    const forwarded: unknown[][]=[];
    (coordinator as unknown as {dispatchComputer: (...args:unknown[])=>Promise<Response>}).dispatchComputer=async (...args)=>{forwarded.push(args);return Response.json({branches:[{name:"main"}]});};
    const request=(user:string,workspace="w",method="GET",action="branches")=>new Request(`https://internal/computers/${input.computerId}/workspaces/${workspace}/${action}`,{method,headers:{"x-thread-member":encodeURIComponent(JSON.stringify({id:user,label:user})),"x-organization-id":"org"}});
    const read=(coordinator as unknown as {threadRequest:(r:Request)=>Promise<Response|undefined>}).threadRequest.bind(coordinator);
    assert.equal((await read(request("ada")))?.status,200);
    assert.equal(forwarded[0]?.[3],"/workspaces/w/branches");
    assert.equal(forwarded[0]?.[4],undefined);
    assert.equal((await read(request("ada","missing")))?.status,404);
    await assert.rejects(read(request("grace")));
    assert.equal((await read(request("ada","w","POST")))?.status,404);
    assert.equal(await read(request("ada","w","GET","checkout")),undefined);
    assert.equal(forwarded.length,1);
  } finally { sqlite.close(); }
});

test("Cursor Cloud connects, stays encrypted, starts without a guest computer, and fails without a key", async () => {
  const { sqlite, db, organizations } = database();
  const { createRouteHandler, HubCoordinator } = await import("./worker.js");
  const { OrganizationService } = await import("./organizations.js");
  const { HostedSettingsStore } = await import("./hosted-settings.js");
  const { setCursorCloudApiForTest } = await import("./cursor-cloud.js");
  const { CURSOR_CLOUD_COMPUTER_ID } = await import("@remy/contract");
  const secret = "test-encryption-root-with-at-least-thirty-two-characters";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    assert.equal(String(input), "https://api.cursor.com/v1/me");
    return Response.json({ apiKeyName: "qa-key" });
  }) as typeof fetch;
  setCursorCloudApiForTest({
    me: async () => ({ apiKeyName: "qa-key" }),
    create: async () => ({ agentId: "agent-1", runId: "run-1" }),
    followUp: async () => ({ runId: "run-2" }),
    stream: async function* () {},
    getRun: async () => ({ status: "FINISHED", result: "Done." }),
    cancel: async () => {},
    archive: async () => {},
  });
  try {
    sqlite.prepare("INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("org-release", "org", "Release", "github.com/example/release", 1, 1);
    const route = createRouteHandler({
      accountService: () => ({ authenticate: async () => ({ userId: "ada", sessionId: "session", clientKind: "web" }) }) as never,
      organizationStore: () => organizations,
      organizationService: () => new OrganizationService(organizations),
    });
    const env = { DB: db, AUTH_SECRET: { get: async () => secret }, BETTER_AUTH_URL: "https://hub.example", COORDINATOR: { idFromName: () => ({}), get: () => ({ fetch: async () => Response.json({ ok: true }) }) } } as never;
    const call = (path: string, method = "GET", payload?: unknown) => route(new Request(`https://hub.example/api/organizations/org/${path}`, { method, headers: { authorization: "Bearer test", origin: "https://hub.example", "content-type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }), env);
    assert.equal((await call("cloud-connection", "PUT", { provider: "cursor-cloud", token: "cursor-secret", enabled: true })).status, 200);
    const hosted = await (await call("hosted")).json() as { enabledProviders: string[]; connections: string[]; available: boolean };
    assert.deepEqual(hosted.enabledProviders, ["cursor-cloud"]);
    assert.ok(hosted.connections.includes("cursor-cloud"));
    assert.equal(hosted.available, true);
    assert.equal(JSON.stringify(hosted).includes("cursor-secret"), false);
    const store = new HostedSettingsStore(db, async () => secret);
    assert.equal(JSON.parse((await store.secrets("org"))["cloud:cursor-cloud"]).token, "cursor-secret");
    assert.equal((await call("cloud-connection", "PATCH", { provider: "cursor-cloud", enabled: false })).status, 200);
    assert.deepEqual((await (await call("hosted")).json() as { enabledProviders: string[] }).enabledProviders, []);
    assert.equal(JSON.parse((await store.secrets("org"))["cloud:cursor-cloud"]).token, "cursor-secret");
    assert.equal((await call("cloud-connection", "PATCH", { provider: "cursor-cloud", enabled: true })).status, 200);
    const personal = await (await import("./personal-space.js")).personalSpace(db, "ada");
    await store.setSecret(personal.id, "cloud:cursor-cloud", JSON.stringify({ provider: "cursor-cloud", enabled: true, token: "cursor-secret" }));
    assert.equal((await call("compute-shares/cloud/cursor-cloud", "PUT")).status, 200);
    const shares = await (await call("compute-shares")).json() as { cloudConnections: { provider: string; providers: { id: string }[] }[] };
    assert.deepEqual(shares.cloudConnections.find(connection => connection.provider === "cursor-cloud")?.providers.map(provider => provider.id), ["cursor"]);

    const values = new Map<string, unknown>([["organizationId", "org"]]);
    let ensured = 0;
    const coordinator = new HubCoordinator({ storage: { get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value); }, delete: async (key: string) => values.delete(key), list: async () => new Map([...values]), getAlarm: async () => null, setAlarm: async () => {}, transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ get: async (key: string) => values.get(key), put: async (key: string, value: unknown) => { values.set(key, value); } }) }, getWebSockets: () => [], waitUntil: (work: Promise<unknown>) => { void work; } } as unknown as DurableObjectState, { DB: db, AUTH_SECRET: { get: async () => secret }, BETTER_AUTH_URL: "https://hub.example" } as never);
    (coordinator as unknown as { hostedService: () => { ensure: () => Promise<unknown> } }).hostedService = () => ({ ensure: async () => { ensured += 1; throw new Error("guest computers must not start for Cursor Cloud"); } });
    const handle = (coordinator as unknown as { threadRequest: (r: Request) => Promise<Response | undefined> }).threadRequest.bind(coordinator);
    const request = (path: string, method: string, payload: unknown) => new Request(`https://internal${path}`, { method, headers: { "content-type": "application/json", "x-thread-member": encodeURIComponent(JSON.stringify({ id: "ada", label: "Ada" })), "x-organization-id": "org" }, body: JSON.stringify(payload) });
    const requestId = crypto.randomUUID();
    const started = await handle(request("/threads", "POST", { workspaceId: "org-release", requestId, computerId: CURSOR_CLOUD_COMPUTER_ID, provider: "cursor", visibility: "private" }));
    assert.equal(started?.status, 202);
    const key = `manual-task:ada:${requestId}`;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const stored = values.get(key) as { id?: string; computerId?: string; error?: string } | undefined;
      if (stored?.id || stored?.error) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const created = values.get(key) as { id?: string; computerId?: string; error?: string };
    assert.equal(created.error, undefined);
    assert.equal(created.computerId, CURSOR_CLOUD_COMPUTER_ID);
    assert.equal(ensured, 0);
    const thread = await (coordinator as unknown as { threads: import("./thread-store.js").ThreadStore }).threads.get(CURSOR_CLOUD_COMPUTER_ID, created.id!);
    assert.equal(thread?.detail.provider, "cursor");
    const claude = await handle(request("/threads", "POST", { workspaceId: "org-release", requestId: crypto.randomUUID(), computerId: CURSOR_CLOUD_COMPUTER_ID, provider: "claude", visibility: "private" }));
    assert.equal(claude?.status, 403);

    await store.setSecret("org", "cloud:cursor-cloud", null);
    await store.setSecret(personal.id, "cloud:cursor-cloud", null);
    const missingId = crypto.randomUUID();
    const missing = await handle(request("/threads", "POST", { workspaceId: "org-release", requestId: missingId, computerId: CURSOR_CLOUD_COMPUTER_ID, provider: "cursor" }));
    assert.equal(missing?.status, 202);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const stored = values.get(`manual-task:ada:${missingId}`) as { error?: string } | undefined;
      if (stored?.error) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const failed = values.get(`manual-task:ada:${missingId}`) as { error?: string };
    assert.match(failed.error ?? "", /Enable a cloud provider|Connect Cursor Cloud|disabled/);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
