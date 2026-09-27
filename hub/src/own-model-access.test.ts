import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
import { HostedSettingsStore } from "./hosted-settings.js";
import { publicModelKeys, removeNamedModelKey, saveNamedModelKey } from "./model-access.js";
import { personalSpace } from "./personal-space.js";
import { D1OrganizationStore } from "./organization-store.js";
import { OrganizationService } from "./organizations.js";
import { D1ComputerStore } from "./computer-store.js";
import { OWN_MODEL_CLOUD_ONLY, OWN_MODEL_THREAD, ownModelAccess, ownModelEnvironment, ownModelError, ownModelMissing, ownModelOff, setOwnModelAccess } from "./own-model-access.js";

const SECRET = "test-encryption-root-with-at-least-thirty-two-characters";

function database() {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(readdirSync(folder).filter((file) => file.endsWith(".sql")).sort().map((file) => readFileSync(new URL(file, folder), "utf8")).join("\n"));
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
    transaction: async <T>(work: (transaction: unknown) => Promise<T>) => work(storage),
  };
  return { values, state: { storage, blockConcurrencyWhile: async <T>(work: () => Promise<T>) => work(), getWebSockets: () => [], waitUntil: (work: Promise<unknown>) => { void work.catch(() => {}); } } as unknown as DurableObjectState };
}

function withRouterModels() {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json({ data: [{ id: "openrouter/auto" }] })) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

test("members enroll exact Personal model keys without making their other keys visible", async () => {
  const { db, sqlite, settings } = database();
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
  const call = (org: string, path = "", method = "GET", payload?: unknown, origin = "https://hub.example") => route(new Request(`https://hub.example/api/organizations/${org}/own-model-access${path}`, { method, headers: { authorization: "Bearer test", origin, "content-type": "application/json" }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }), env);
  try {
    const personal = await personalSpace(db, "ada");
    assert.deepEqual(await (await call(personal.id)).json(), { personal: true, providers: [], enrolled: [] });
    assert.equal((await call(personal.id, "/anthropic", "PUT", { keyIds: ["legacy"] })).status, 409);

    await saveNamedModelKey(settings, personal.id, "anthropic", { name: "Production", apiKey: "ada-production" });
    await saveNamedModelKey(settings, personal.id, "anthropic", { name: "Sandbox", apiKey: "ada-sandbox" });
    const keys = publicModelKeys("anthropic", await settings.secrets(personal.id));
    const production = keys.find((key) => key.name === "Production")!;
    const sandbox = keys.find((key) => key.name === "Sandbox")!;

    const before = await (await call("org")).json() as Awaited<ReturnType<typeof ownModelAccess>>;
    const anthropic = before.providers.find((provider) => provider.id === "anthropic")!;
    assert.equal(anthropic.allowed, true, "all of your configured keys already work for your own threads");
    assert.deepEqual(anthropic.keys.map((key) => ({ id: key.id, enrolled: key.enrolled })), keys.map((key) => ({ id: key.id, enrolled: false })));

    const enrolledResponse = await call("org", "/anthropic", "PUT", { keyIds: [production.id] });
    assert.equal(enrolledResponse.status, 200);
    const text = await enrolledResponse.text();
    assert.ok(!text.includes("ada-production") && !text.includes("ada-sandbox"), "secret values never leave the hub");

    userId = "grace";
    const grace = await (await call("org")).json() as Awaited<ReturnType<typeof ownModelAccess>>;
    assert.deepEqual(grace.enrolled.map((entry) => ({ owner: entry.owner, provider: entry.provider, keyId: entry.keyId, keyName: entry.keyName })), [
      { owner: "Ada", provider: "anthropic", keyId: production.id, keyName: "Production" },
    ]);
    assert.ok(!JSON.stringify(grace).includes(sandbox.id), "an unenrolled key is not disclosed to another member");

    userId = "ada";
    assert.equal((await call("org", "/anthropic", "PUT", { keyIds: [sandbox.id] }, "https://foreign.example")).status, 403);
    assert.equal((await call("org", "/anthropic", "DELETE")).status, 200);
    userId = "grace";
    assert.deepEqual((await ownModelAccess(db, settings, "org", "grace")).enrolled, []);

    clientKind = "computer";
    assert.equal((await call("org")).status, 403);
  } finally {
    sqlite.close();
  }
});

test("own model keys need no enrollment while enrolled keys are rechecked for every member", async () => {
  const { db, sqlite, settings } = database();
  try {
    const personal = await personalSpace(db, "lin");
    await saveNamedModelKey(settings, personal.id, "anthropic", { name: "Team", apiKey: "lin-private" });
    const keyId = publicModelKeys("anthropic", await settings.secrets(personal.id))[0]!.id;
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic", keyId), undefined, "the owner uses their key without enrolling it");
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic", keyId, true), ownModelOff("anthropic"));

    await setOwnModelAccess(db, settings, "org", "lin", "anthropic", true, [keyId]);
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic", keyId, true), undefined);
    await setOwnModelAccess(db, settings, "org", "lin", "anthropic", false);
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic", keyId), undefined, "removing enrollment does not stop its owner");
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic", keyId, true), ownModelOff("anthropic"));

    await setOwnModelAccess(db, settings, "org", "lin", "anthropic", true, [keyId]);
    await removeNamedModelKey(settings, personal.id, "anthropic", keyId);
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic", keyId), ownModelMissing("anthropic"));
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic", keyId, true), ownModelOff("anthropic"));

    await new D1OrganizationStore(db).removeMembership("org", "lin");
    assert.equal(await ownModelError(db, settings, "org", "lin", "anthropic", keyId), OWN_MODEL_THREAD);
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM organization_own_model_access WHERE user_id='lin'").get()!.n, 0);
  } finally {
    sqlite.close();
  }
});

test("the task environment uses only the exact model key that was selected", async () => {
  const { db, sqlite, settings } = database();
  const restore = withRouterModels();
  try {
    const personal = await personalSpace(db, "ada");
    await saveNamedModelKey(settings, personal.id, "openrouter", { name: "Production", apiKey: "ada-production" });
    await saveNamedModelKey(settings, personal.id, "openrouter", { name: "Sandbox", apiKey: "ada-sandbox" });
    const sandbox = publicModelKeys("openrouter", await settings.secrets(personal.id)).find((key) => key.name === "Sandbox")!;
    const base = { ANTHROPIC_API_KEY: "org-anthropic", OPENROUTER_API_KEY: "org-openrouter", OPENROUTER_MODELS: JSON.stringify(["org/model"]) };
    const environment = await ownModelEnvironment(db, settings, "org", base, { userId: "ada", provider: "openrouter", keyId: sandbox.id });
    assert.deepEqual(environment, { ANTHROPIC_API_KEY: "org-anthropic", OPENROUTER_API_KEY: "ada-sandbox", OPENROUTER_MODELS: JSON.stringify(["openrouter/auto"]) });
    assert.equal(base.OPENROUTER_API_KEY, "org-openrouter");
  } finally {
    restore();
    sqlite.close();
  }
});

test("thread starts keep the exact cloud and model connections independently", async () => {
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

    const gracePersonal = await personalSpace(db, "grace");
    await settings.setSecret(gracePersonal.id, "cloud:modal", JSON.stringify({ provider: "modal", enabled: true, tokenId: "private-id", tokenSecret: "private-secret" }));
    await saveNamedModelKey(settings, gracePersonal.id, "openrouter", { name: "Team", apiKey: "grace-openrouter" });
    const graceModelKey = publicModelKeys("openrouter", await settings.secrets(gracePersonal.id))[0]!.id;
    assert.equal((await call("compute-shares/cloud/modal", "PUT", { keyIds: ["legacy"] })).status, 200);
    await setOwnModelAccess(db, settings, "org", "grace", "openrouter", true, [graceModelKey]);

    const adaPersonal = await personalSpace(db, "ada");
    await saveNamedModelKey(settings, adaPersonal.id, "openrouter", { name: "Personal", apiKey: "ada-openrouter" });
    const adaModelKey = publicModelKeys("openrouter", await settings.secrets(adaPersonal.id))[0]!.id;

    const { values, state } = memoryState();
    const coordinator = new HubCoordinator(state, env as never);
    const handle = (coordinator as unknown as { threadRequest: (request: Request) => Promise<Response | undefined> }).threadRequest.bind(coordinator);
    const start = (payload: Record<string, unknown>, actor = "ada") => handle(new Request("https://internal/threads", { method: "POST", headers: { "content-type": "application/json", "x-thread-member": encodeURIComponent(JSON.stringify({ id: actor, label: actor })), "x-organization-id": "org" }, body: JSON.stringify({ workspaceId: "org-release", requestId: crypto.randomUUID(), message: "Test.", visibility: "private", ...payload }) }));
    const error = async (response: Response | undefined) => ((await response!.json()) as { error: string }).error;
    const cloudId = `cloud:modal:${gracePersonal.id}:legacy`;

    const local = await start({ computerId: crypto.randomUUID(), provider: "codex", model: "remy:openrouter:openrouter/auto", modelSource: "own", modelProvider: "openrouter", modelConnection: adaModelKey });
    assert.equal(local?.status, 409);
    assert.equal(await error(local), OWN_MODEL_CLOUD_ONLY);

    const ownRequest = crypto.randomUUID();
    const own = await start({ requestId: ownRequest, computerId: cloudId, provider: "codex", model: "remy:openrouter:openrouter/auto", modelSource: "own", modelProvider: "openrouter", modelConnection: adaModelKey });
    assert.equal(own?.status, 202, "your own key works without an organization enrollment");
    await (coordinator as unknown as { manualStarts: Map<string, Promise<void>> }).manualStarts.get(`manual-task:ada:${ownRequest}`);
    const ownTask = `ada:${ownRequest}`;
    assert.deepEqual(values.get(`hosted-task-cloud:${ownTask}`), { sourceOrganizationId: gracePersonal.id, provider: "modal", keyId: "legacy" });
    assert.deepEqual(values.get(`hosted-task-own-model:${ownTask}`), { userId: "ada", provider: "openrouter", keyId: adaModelKey });

    const enrolledRequest = crypto.randomUUID();
    const enrolled = await start({ requestId: enrolledRequest, computerId: cloudId, provider: "codex", model: "remy:openrouter:openrouter/auto", modelSource: "enrolled", modelProvider: "openrouter", modelConnection: `grace:openrouter:${graceModelKey}` });
    assert.equal(enrolled?.status, 202);
    await (coordinator as unknown as { manualStarts: Map<string, Promise<void>> }).manualStarts.get(`manual-task:ada:${enrolledRequest}`);
    assert.deepEqual(values.get(`hosted-task-own-model:ada:${enrolledRequest}`), { userId: "grace", provider: "openrouter", keyId: graceModelKey, enrolled: true });

    const hosted = (coordinator as unknown as { hostedService: () => { prepare: (state: unknown) => Promise<{ environment: Record<string, string> }> } }).hostedService();
    const boot = (taskId: string) => hosted.prepare({ workspaceId: "org-release", taskId, computerId: crypto.randomUUID(), provider: "modal", settings: {} });
    const booted = await boot(ownTask);
    assert.equal(booted.environment.OPENROUTER_API_KEY, "ada-openrouter");
    assert.equal(booted.environment.ANTHROPIC_API_KEY, undefined, "the cloud key does not bring its owner's model keys");
    assert.ok(!booted.environment.REMY_HOSTED_BOOTSTRAP.includes("ada-openrouter"));

    await setOwnModelAccess(db, settings, "org", "grace", "openrouter", false);
    await assert.rejects(boot(`ada:${enrolledRequest}`), (error: Error) => error.message === OWN_MODEL_THREAD);
  } finally {
    restore();
    sqlite.close();
  }
});
