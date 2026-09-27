import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { HostedSettingsStore } from "./hosted-settings.js";
import { saveModelAccess, removeNamedModelKey } from "./model-access.js";
import { personalSpace } from "./personal-space.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
import { D1ComputerStore } from "./computer-store.js";
import { OWN_MODEL_CLOUD_ONLY, OWN_MODEL_THREAD, ownModelEnvironment, ownModelError, ownModelMissing, ownModelOff, setOwnModelAccess } from "./own-model-access.js";
import { START_PROVIDER_DENIED } from "./computer-start-access.js";

const SECRET = "test-encryption-root-with-at-least-thirty-two-characters";

function database() {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(readdirSync(folder).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, folder), "utf8")).join("\n"));
  sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@test.dev',1,1),('grace','Grace','grace@test.dev',1,1),('lin','Lin','lin@test.dev',1,1);");
  sqlite.exec("INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Studio',1,1);");
  sqlite.exec("INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','org','ada','owner',1,1),('m2','org','grace','member',1,1),('m3','org','lin','member',1,1);");
  sqlite.exec("INSERT INTO organization_workspaces(id,organization_id,name,origin,created_at,updated_at) VALUES('org-release','org','Release','github.com/example/release',1,1);");
  return { db, sqlite, settings: new HostedSettingsStore(db, async () => SECRET) };
}

function memoryState() {
  const values = new Map<string, unknown>([["organizationId", "org"]]);
  const storage = {
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    delete: async (key: string) => values.delete(key),
    list: async ({ prefix }: { prefix?: string } = {}) => new Map([...values].filter(([key]) => !prefix || key.startsWith(prefix))),
    getAlarm: async () => null,
    setAlarm: async () => {},
    transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(storage),
  };
  return { values, state: { storage, blockConcurrencyWhile: async <T>(work: () => Promise<T>) => work(), getWebSockets: () => [], waitUntil: (work: Promise<unknown>) => { void work.catch(() => {}); } } as unknown as DurableObjectState };
}

function withRouterModels() {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ data: [{ id: "openrouter/auto" }] })) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("your own keys are listed per organization, off by default, and never show a value", async () => {
  const { db, sqlite, settings } = database();
  const restore = withRouterModels();
  const { createRouteHandler } = await import("./worker.js");
  let userId = "ada", clientKind = "web";
  const organizations = new D1OrganizationStore(db);
  const route = createRouteHandler({
    accountService: () => ({ authenticate: async () => ({ userId, sessionId: "session", clientKind }) }) as never,
    organizationStore: () => organizations,
    organizationService: () => new OrganizationService(organizations),
    computerStore: () => new D1ComputerStore(db),
  });
  const env = { DB: db, AUTH_SECRET: { get: async () => SECRET }, BETTER_AUTH_URL: "https://hub.example", COORDINATOR: { idFromName: (id: string) => id, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } } as never;
  const call = (org: string, path = "", method = "GET") => route(new Request(`https://hub.example/api/organizations/${org}/own-model-access${path}`, { method, headers: { authorization: "Bearer test", origin: "https://hub.example" } }), env);
  try {
    const personal = await personalSpace(db, "ada");
    assert.deepEqual(await (await call(personal.id)).json(), { personal: true, providers: [] }, "Personal always runs on your own keys");
    assert.equal((await call(personal.id, "/anthropic", "PUT")).status, 409);

    const empty = await (await call("org")).json() as { personal: boolean; providers: { id: string; configured: boolean; allowed: boolean }[] };
    assert.equal(empty.personal, false);
    assert.deepEqual(empty.providers.map((p) => p.id), ["chatgpt", "anthropic", "openai", "router", "openrouter"]);
    assert.deepEqual(empty.providers.find((p) => p.id === "anthropic"), { id: "anthropic", configured: false, allowed: false, keyName: null, models: [] });
    assert.deepEqual(empty.providers.find((p) => p.id === "chatgpt"), { id: "chatgpt", configured: false, allowed: true, keyName: null, models: [] }, "ChatGPT keeps its existing default");

    const unconfigured = await call("org", "/anthropic", "PUT");
    assert.equal(unconfigured.status, 409);
    assert.equal(((await unconfigured.json()) as { error: string }).error, ownModelMissing("anthropic"));
    assert.equal((await call("org", "/chatgpt", "PUT")).status, 409, "ChatGPT needs a sign-in first");
    assert.equal((await call("org", "/codex", "PUT")).status, 405);

    await saveModelAccess(settings, personal.id, "anthropic", { enabled: true, apiKey: "ada-private-anthropic" });
    await saveModelAccess(settings, personal.id, "openrouter", { enabled: true, apiKey: "ada-private-openrouter" });
    const configured = await (await call("org")).json() as { providers: { id: string; configured: boolean; allowed: boolean; keyName: string | null; models: string[] }[] };
    assert.deepEqual(configured.providers.find((p) => p.id === "anthropic"), { id: "anthropic", configured: true, allowed: false, keyName: "Default", models: [] }, "a configured key is still off here");
    assert.deepEqual(configured.providers.find((p) => p.id === "openrouter")?.models, ["openrouter/auto"]);

    const on = await call("org", "/anthropic", "PUT");
    assert.equal(on.status, 200);
    const text = await on.text();
    assert.ok(!text.includes("ada-private"), "no key value leaves the hub");
    assert.equal((JSON.parse(text) as { providers: { id: string; allowed: boolean }[] }).providers.find((p) => p.id === "anthropic")?.allowed, true);
    assert.equal((await call("org", "/anthropic", "PUT", )).status, 200, "turning it on twice is harmless");
    assert.equal((await call("org", "/anthropic", "PUT")).headers.get("cache-control"), "no-store");

    userId = "grace";
    const graceView = await (await call("org")).json() as { providers: { id: string; configured: boolean; allowed: boolean }[] };
    assert.deepEqual(graceView.providers.find((p) => p.id === "anthropic"), { id: "anthropic", configured: false, allowed: false, keyName: null, models: [] }, "nobody else sees your key or your switch");

    userId = "ada";
    const off = await (await call("org", "/anthropic", "DELETE")).json() as { providers: { id: string; allowed: boolean }[] };
    assert.equal(off.providers.find((p) => p.id === "anthropic")?.allowed, false);
    assert.equal((await call("org", "/anthropic", "PUT", )).status, 200);
    const cross = await route(new Request("https://hub.example/api/organizations/org/own-model-access/anthropic", { method: "PUT", headers: { authorization: "Bearer test", origin: "https://foreign.example" } }), env);
    assert.equal(cross.status, 403);

    clientKind = "computer";
    assert.equal((await call("org")).status, 403, "a computer session never reads your keys");

    clientKind = "web";
    const models = await (await route(new Request("https://hub.example/api/organizations/org/model-access", { headers: { authorization: "Bearer test" } }), env)).json() as { providers: unknown[] };
    assert.equal(models.providers.length, 4);
    userId = "grace";
    assert.equal((await route(new Request("https://hub.example/api/organizations/org/model-access", { headers: { authorization: "Bearer test" } }), env)).status, 200, "members read the organization's model access");
    assert.equal((await route(new Request("https://hub.example/api/organizations/org/model-access/anthropic", { method: "PATCH", headers: { authorization: "Bearer test", origin: "https://hub.example", "content-type": "application/json" }, body: JSON.stringify({ enabled: false }) }), env)).status, 403, "only administrators change it");
  } finally {
    restore();
    sqlite.close();
  }
});

test("a removed key, a switch turned off, or leaving the organization stops your own key", async () => {
  const { db, sqlite, settings } = database();
  try {
    const personal = await personalSpace(db, "lin");
    await saveModelAccess(settings, personal.id, "anthropic", { enabled: true, apiKey: "lin-private" });
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic"), ownModelOff("anthropic"));
    await setOwnModelAccess(db, settings, "org", "lin", "anthropic", true);
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic"), undefined);
    await saveModelAccess(settings, personal.id, "anthropic", { enabled: false });
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic"), ownModelMissing("anthropic"), "a key turned off in Personal stops here too");
    await saveModelAccess(settings, personal.id, "anthropic", { enabled: true });
    await removeNamedModelKey(settings, personal.id, "anthropic", "legacy");
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic"), ownModelMissing("anthropic"), "a removed key stops here too");
    await saveModelAccess(settings, personal.id, "anthropic", { enabled: true, apiKey: "lin-private" });
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic"), undefined);
    await new D1OrganizationStore(db).removeMembership("org", "lin");
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic"), OWN_MODEL_THREAD);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM organization_own_model_access WHERE user_id='lin'").get()!.n, 0, "leaving takes the switch back");
  } finally {
    sqlite.close();
  }
});

test("the task computer runs on the starter's own key for only the provider they picked", async () => {
  const { db, sqlite, settings } = database();
  const restore = withRouterModels();
  try {
    const personal = await personalSpace(db, "ada");
    await saveModelAccess(settings, personal.id, "openrouter", { enabled: true, apiKey: "ada-private-openrouter" });
    const base = { ANTHROPIC_API_KEY: "org-anthropic", OPENROUTER_API_KEY: "org-openrouter", OPENROUTER_MODELS: JSON.stringify(["org/model"]) };
    const environment = await ownModelEnvironment(db, settings, base, { userId: "ada", provider: "openrouter" });
    assert.deepEqual(environment, { ANTHROPIC_API_KEY: "org-anthropic", OPENROUTER_API_KEY: "ada-private-openrouter", OPENROUTER_MODELS: JSON.stringify(["openrouter/auto"]) });
    assert.equal(base.OPENROUTER_API_KEY, "org-openrouter", "the organization's environment is not changed");
    await assert.rejects(ownModelEnvironment(db, settings, base, { userId: "ada", provider: "anthropic" }), /Add your Anthropic key/);
  } finally {
    restore();
    sqlite.close();
  }
});

test("starting on your own key needs the switch, a cloud computer, and bypasses the share's start list", async () => {
  const { db, sqlite, settings } = database();
  const restore = withRouterModels();
  const { createRouteHandler, HubCoordinator } = await import("./worker.js");
  let userId = "grace";
  try {
    const organizations = new D1OrganizationStore(db);
    const computers = new D1ComputerStore(db);
    const route = createRouteHandler({
      accountService: () => ({ authenticate: async () => ({ userId, sessionId: "session", clientKind: "web" }) }) as never,
      computerStore: () => computers,
      organizationStore: () => organizations,
      organizationService: () => new OrganizationService(organizations),
    });
    const env = { DB: db, AUTH_SECRET: { get: async () => SECRET }, BETTER_AUTH_URL: "https://hub.example", HOSTED_IMAGE: "registry.example/remy:test", COORDINATOR: { idFromName: (id: string) => id, get: () => ({ fetch: async () => Response.json({ ok: true }) }) } };
    const call = (path: string, method = "GET", payload?: unknown) => route(new Request(`https://hub.example/api/organizations/org/${path}`, { method, headers: { authorization: "Bearer session", origin: "https://hub.example", "content-type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }), env as never);

    // Grace shares her cloud computer into the organization for Anthropic only.
    const gracePersonal = await personalSpace(db, "grace");
    await settings.setSecret(gracePersonal.id, "cloud:modal", JSON.stringify({ provider: "modal", enabled: true, tokenId: "private-id", tokenSecret: "private-secret" }));
    await saveModelAccess(settings, gracePersonal.id, "anthropic", { enabled: true, apiKey: "grace-anthropic" });
    await saveModelAccess(settings, gracePersonal.id, "openrouter", { enabled: true, apiKey: "grace-openrouter" });
    assert.equal((await call("compute-shares/cloud/modal", "PUT")).status, 200);
    assert.equal((await call("compute-shares/cloud/modal", "PATCH", { startProviders: ["anthropic"] })).status, 200);

    const adaPersonal = await personalSpace(db, "ada");
    await saveModelAccess(settings, adaPersonal.id, "openrouter", { enabled: true, apiKey: "ada-private-openrouter" });

    const { values, state } = memoryState();
    const coordinator = new HubCoordinator(state, env as never);
    const handle = (coordinator as unknown as { threadRequest: (r: Request) => Promise<Response | undefined> }).threadRequest.bind(coordinator);
    const start = (payload: Record<string, unknown>, user = "ada") => handle(new Request("https://internal/threads", { method: "POST", headers: { "content-type": "application/json", "x-thread-member": encodeURIComponent(JSON.stringify({ id: user, label: user })), "x-organization-id": "org" }, body: JSON.stringify({ workspaceId: "org-release", requestId: crypto.randomUUID(), visibility: "private", ...payload }) }));
    const error = async (response: Response | undefined) => ((await response!.json()) as { error: string }).error;

    const denied = await start({ computerId: "cloud:modal", provider: "openrouter", model: "openrouter/auto" });
    assert.equal(denied?.status, 403, "without your own key, the share's list decides");
    assert.equal(await error(denied), START_PROVIDER_DENIED);

    const off = await start({ computerId: "cloud:modal", provider: "openrouter", model: "openrouter/auto", modelSource: "own" });
    assert.equal(off?.status, 409, "your own key is off in an organization until you turn it on");
    assert.equal(await error(off), ownModelOff("openrouter"));

    await setOwnModelAccess(db, settings, "org", "ada", "openrouter", true);
    const local = await start({ computerId: "b7ebfcbe-f2f4-4a1b-8707-3029fa65d14b", provider: "openrouter", model: "openrouter/auto", modelSource: "own" });
    assert.equal(local?.status, 409);
    assert.equal(await error(local), OWN_MODEL_CLOUD_ONLY);
    assert.equal((await start({ computerId: "cloud:modal", provider: "codex", modelSource: "own" }))?.status, 400);
    assert.equal((await start({ computerId: "cloud:modal", provider: "openrouter", modelSource: "shared" }))?.status, 400);
    assert.equal((await start({ computerId: "cloud:modal", provider: "anthropic", model: "claude-opus-5-5", modelSource: "own" }))?.status, 409, "a provider you have no key for is refused");

    const requestId = crypto.randomUUID();
    const allowed = await start({ requestId, computerId: "cloud:modal", provider: "openrouter", model: "openrouter/auto", modelSource: "own" });
    assert.equal(allowed?.status, 202, "your own key bypasses the share's start list");
    await (coordinator as unknown as { manualStarts: Map<string, Promise<void>> }).manualStarts.get(`manual-task:ada:${requestId}`);
    const taskId = `ada:${requestId}`;
    assert.deepEqual(values.get(`hosted-task-own-model:${taskId}`), { userId: "ada", provider: "openrouter" }, "the thread keeps the key it was started on");

    // The task computer boots with Ada's key in place of the shared one.
    const hosted = (coordinator as unknown as { hostedService: () => { prepare: (state: unknown) => Promise<{ environment: Record<string, string> }> } }).hostedService();
    const boot = (task: string) => hosted.prepare({ workspaceId: "org-release", taskId: task, computerId: crypto.randomUUID(), provider: "modal", settings: {} });
    const booted = await boot(taskId);
    assert.equal(booted.environment.OPENROUTER_API_KEY, "ada-private-openrouter");
    assert.equal(booted.environment.ANTHROPIC_API_KEY, "grace-anthropic", "other providers still come from the organization");
    assert.ok(!booted.environment.REMY_HOSTED_BOOTSTRAP.includes("ada-private"), "the key stays out of the bootstrap snapshot");

    await setOwnModelAccess(db, settings, "org", "ada", "openrouter", false);
    await assert.rejects(boot(taskId), (e: Error) => e.message === OWN_MODEL_THREAD, "turning it off stops the next boot");
  } finally {
    restore();
    sqlite.close();
  }
});
