import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { sqliteD1 } from "../test/sqlite-d1.js";
// @ts-expect-error The fake auth server is a plain module shared with the QA hub.
import { startFakeOpenAIAuth } from "../scripts/fake-openai-auth.mjs";
import { ChatGPTAccounts, RECONNECT_CODEX, isChatGPTModel, setChatGPTEnabled } from "./chatgpt-account.js";
import { createHash } from "node:crypto";
import { HostedSettingsStore } from "./hosted-settings.js";
import { personalSpace } from "./personal-space.js";
import type { KeyValueStorage } from "./durable-storage.js";

const SECRET = "test-encryption-root-with-at-least-thirty-two-characters";
type Fake = Awaited<ReturnType<typeof startFakeOpenAIAuth>> & { calls: Record<string, number>; state: { accessTtlSeconds: number; refreshDelayMs: number } };

function database() {
  const folder = new URL("../migrations/", import.meta.url);
  const { db, sqlite } = sqliteD1(readdirSync(folder).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(new URL(f, folder), "utf8")).join("\n"));
  sqlite.exec("INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('ada','Ada','ada@test.dev',1,1),('grace','Grace','grace@test.dev',1,1);");
  sqlite.exec("INSERT INTO organizations(id,name,createdAt,updatedAt) VALUES('org','Studio',1,1);");
  sqlite.exec("INSERT INTO memberships(id,organization_id,user_id,role,createdAt,updatedAt) VALUES('m1','org','ada','owner',1,1),('m2','org','grace','member',1,1);");
  return { db, sqlite };
}

function memory(): KeyValueStorage & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  const storage = {
    values,
    get: async <T>(key: string) => values.get(key) as T | undefined,
    put: async <T>(key: string, value: T) => { values.set(key, structuredClone(value)); },
    delete: async (key: string) => values.delete(key),
    list: async <T>({ prefix }: { prefix: string }) => new Map([...values].filter(([key]) => key.startsWith(prefix)) as [string, T][]),
    transaction: async <T>(work: (storage: KeyValueStorage) => Promise<T>): Promise<T> => work(storage as KeyValueStorage),
    // What a Durable Object's storage adds, for HubCoordinator.
    getAlarm: async () => null,
    setAlarm: async () => {},
  };
  return storage;
}

function objectState(storage = memory()) {
  return { storage, blockConcurrencyWhile: async <T>(work: () => Promise<T>) => work(), getWebSockets: () => [], waitUntil: (work: Promise<unknown>) => { void work; } } as unknown as DurableObjectState;
}

async function signIn(accounts: ChatGPTAccounts, fake: Fake, userId: string, who: { email: string; accountId: string }) {
  const pending = await accounts.start(userId);
  assert.equal(pending.phase, "pending");
  fake.approve(who);
  return accounts.status(userId);
}

test("the hub signs you in with a ChatGPT device code and returns only your status", async () => {
  const fake = await startFakeOpenAIAuth() as Fake;
  const { db, sqlite } = database();
  let clock = Date.now();
  try {
    const accounts = new ChatGPTAccounts(db, new HostedSettingsStore(db, async () => SECRET), memory(), fetch, fake.url, () => clock);
    assert.deepEqual(await accounts.status("ada"), { phase: "signedOut" });
    const pending = await accounts.start("ada");
    assert.deepEqual(pending, { phase: "pending", userCode: "DEMO-0000", verificationUrl: `${fake.url}/codex/device` });
    assert.equal((await accounts.status("ada")).phase, "pending", "an unapproved code keeps waiting");
    clock += 500;
    assert.equal((await accounts.status("ada")).phase, "pending");
    assert.equal(fake.calls.poll, 1, "the hub waits Codex's interval between polls");
    fake.approve({ email: "ada@chatgpt.test", accountId: "acct-ada" });
    clock += 1000;
    const connected = await accounts.status("ada");
    assert.deepEqual(connected, { phase: "connected", email: "ada@chatgpt.test" });
    assert.ok(!JSON.stringify(connected).includes("fake-refresh"));
    const row = sqlite.prepare("SELECT organization_id,ciphertext FROM personal_chatgpt_accounts WHERE user_id='ada'").get() as { organization_id: string; ciphertext: string };
    assert.equal(row.organization_id, (await personalSpace(db, "ada")).id, "the sign-in lives under your Personal scope");
    assert.ok(!row.ciphertext.includes("fake-refresh") && !row.ciphertext.includes("acct-ada"), "stored tokens are sealed");
    await assert.rejects(new HostedSettingsStore(db, async () => SECRET).unseal("org:chatgpt", row.ciphertext), "another scope cannot open it");
    assert.equal((await accounts.tokens("ada"))?.chatgptAccountId, "acct-ada");
    assert.equal(await accounts.tokens("grace"), undefined, "nobody else's sign-in answers for you");
    assert.deepEqual(await accounts.logout("ada"), { phase: "signedOut" });
    assert.equal(await accounts.tokens("ada"), undefined, "signing out removes the stored tokens");
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM personal_chatgpt_accounts").get()!.n, 0);
  } finally {
    sqlite.close();
    await fake.close();
  }
});

test("refreshes run one at a time, so a rotated refresh token is never reused", async () => {
  const fake = await startFakeOpenAIAuth({ accessTtlSeconds: 60, refreshDelayMs: 30 }) as Fake;
  const { db, sqlite } = database();
  try {
    let clock = Date.now();
    const accounts = new ChatGPTAccounts(db, new HostedSettingsStore(db, async () => SECRET), memory(), fetch, fake.url, () => clock);
    await signIn(accounts, fake, "ada", { email: "ada@chatgpt.test", accountId: "acct-ada" });
    // Each token is close to expiring, so each request refreshes with the token the last one rotated in.
    const served = await Promise.all([accounts.tokens("ada"), accounts.tokens("ada"), accounts.tokens("ada")]);
    assert.equal(fake.calls.refresh, 3);
    assert.ok(served.every((tokens) => tokens?.chatgptAccountId === "acct-ada"));
    assert.equal(new Set(served.map((tokens) => tokens?.accessToken)).size, 3);
    fake.state.accessTtlSeconds = 3600;
    await accounts.tokens("ada");
    const refreshes = fake.calls.refresh;
    await accounts.tokens("ada");
    assert.equal(fake.calls.refresh, refreshes, "a fresh token is served without refreshing");
    clock += 2 * 3600_000;
    fake.revokeAll();
    assert.equal(await accounts.tokens("ada"), undefined, "a revoked refresh token signs you out");
    assert.deepEqual(await accounts.status("ada"), { phase: "error", error: RECONNECT_CODEX });
  } finally {
    sqlite.close();
    await fake.close();
  }
});

test("a rejected token forces a real refresh, once, even when two tasks report it", async () => {
  const fake = await startFakeOpenAIAuth({ refreshDelayMs: 30 }) as Fake;
  const { db, sqlite } = database();
  const hash = (token: string) => createHash("sha256").update(token).digest("hex");
  try {
    const accounts = new ChatGPTAccounts(db, new HostedSettingsStore(db, async () => SECRET), memory(), fetch, fake.url);
    await signIn(accounts, fake, "ada", { email: "ada@chatgpt.test", accountId: "acct-ada" });
    const first = (await accounts.tokens("ada"))!;
    assert.equal(fake.calls.refresh, 0, "a fresh token is served as it is");
    const [a, b] = await Promise.all([accounts.tokens("ada", { rejected: hash(first.accessToken) }), accounts.tokens("ada", { rejected: hash(first.accessToken) })]);
    assert.equal(fake.calls.refresh, 1, "the second caller gets the token the first one rotated in");
    assert.notEqual(a!.accessToken, first.accessToken);
    assert.equal(b!.accessToken, a!.accessToken);
    const forced = await accounts.tokens("ada", { rejected: hash(a!.accessToken) });
    assert.equal(fake.calls.refresh, 2);
    assert.notEqual(forced!.accessToken, a!.accessToken);
    const latest = await accounts.tokens("ada", {});
    assert.equal(fake.calls.refresh, 3, "a refresh request without the rejected token still refreshes");
    fake.revokeAll();
    assert.equal(await accounts.tokens("ada", { rejected: hash(latest!.accessToken) }), undefined, "a revoked refresh token signs you out");
    assert.deepEqual(await accounts.status("ada"), { phase: "error", error: RECONNECT_CODEX });
  } finally {
    sqlite.close();
    await fake.close();
  }
});

test("plain Codex is the ChatGPT model; a remy: gateway model is an API key", () => {
  assert.equal(isChatGPTModel("codex", "gpt-5.6-sol"), true);
  assert.equal(isChatGPTModel("codex", null), true);
  assert.equal(isChatGPTModel("codex", "remy:openai:gpt-5.6-sol"), false);
  assert.equal(isChatGPTModel("claude", "claude-opus-5-5"), false);
});

test("a cloud task gets only its starter's ChatGPT tokens, and none once they turn it off", async () => {
  const fake = await startFakeOpenAIAuth() as Fake;
  const { db, sqlite } = database();
  const { HubCoordinator } = await import("./worker.js");
  const objects = new Map<string, InstanceType<typeof HubCoordinator>>();
  const env = {
    DB: db, AUTH_SECRET: { get: async () => SECRET }, BETTER_AUTH_URL: "https://hub.example", CHATGPT_AUTH_ISSUER: fake.url,
    COORDINATOR: { idFromName: (name: string) => name, get: (name: string) => {
      if (!objects.has(name)) objects.set(name, new HubCoordinator(objectState(), env as never));
      return objects.get(name)!;
    } },
  };
  const person = (userId: string, action: string, as = userId) => env.COORDINATOR.get(`chatgpt:${userId}`).fetch(new Request(`https://internal/chatgpt-account/${action}`, { method: "POST", headers: { "x-chatgpt-user": as } }));
  try {
    for (const [userId, accountId] of [["ada", "acct-ada"], ["grace", "acct-grace"]]) {
      assert.equal(((await (await person(userId, "start")).json()) as { phase: string }).phase, "pending");
      fake.approve({ email: `${userId}@chatgpt.test`, accountId });
      assert.equal(((await (await person(userId, "status")).json()) as { phase: string }).phase, "connected");
    }
    assert.equal((await person("ada", "tokens", "grace")).status, 403, "one person's object never serves another person");

    const storage = memory();
    const task = (taskId: string, computerId: string) => ({ workspaceId: "ws", computerId, taskId, provider: "modal", phase: "ready", lastUsedAt: 1, usage: { activeMs: 0, warmIdleMs: 0, snapshotByteMs: 0 }, timing: {}, settings: {}, meteredAt: 1, active: true, sources: [] });
    for (const [taskId, computerId, owner, chatgpt] of [["t-ada", "c-ada", "ada", true], ["t-grace", "c-grace", "grace", true], ["t-key", "c-key", "ada", false]] as const) {
      await storage.put(`hosted:task:${taskId}`, task(taskId, computerId));
      await storage.put(`hosted-task-owner:${taskId}`, owner);
      if (chatgpt) await storage.put(`hosted-task-chatgpt:${taskId}`, true);
    }
    const organization = new HubCoordinator(objectState(storage), env as never);
    const tokensFor = (computerId: string, refresh?: unknown) => organization.fetch(new Request("https://internal/codex-tokens", { method: "POST", headers: { "x-organization-id": "org", "x-computer-id": computerId }, ...(refresh ? { body: JSON.stringify(refresh) } : {}) }));
    const ada = await tokensFor("c-ada");
    assert.equal(ada.status, 200);
    assert.equal(((await ada.json()) as { chatgptAccountId: string }).chatgptAccountId, "acct-ada");
    const grace = await tokensFor("c-grace");
    assert.equal(((await grace.json()) as { chatgptAccountId: string }).chatgptAccountId, "acct-grace", "a member's task gets their own tokens");
    const served = await (await tokensFor("c-ada")).json() as { accessToken: string };
    const refreshes = fake.calls.refresh;
    const forced = await (await tokensFor("c-ada", { reason: "unauthorized", rejected: createHash("sha256").update(served.accessToken).digest("hex") })).json() as { accessToken: string };
    assert.equal(fake.calls.refresh, refreshes + 1, "a rejected token reaches the person's object and forces a refresh");
    assert.notEqual(forced.accessToken, served.accessToken);
    assert.equal((await tokensFor("c-key")).status, 204, "a thread started on an API key gets no ChatGPT tokens");
    assert.equal((await tokensFor("c-missing")).status, 403);

    await setChatGPTEnabled(db, "org", "grace", false);
    const off = await tokensFor("c-grace");
    assert.equal(off.status, 409);
    const body = await off.text();
    assert.match(body, /Reconnect Codex to continue/);
    assert.ok(!body.includes("acct-grace") && !body.includes("fake"), "no tokens once the starter turns it off");
    assert.equal((await tokensFor("c-ada")).status, 200, "the toggle is per person");

    await person("ada", "logout");
    assert.equal((await tokensFor("c-ada")).status, 409, "signing out fails the next refresh");
  } finally {
    sqlite.close();
    await fake.close();
  }
});

test("browsers read only your status, and computers cannot reach ChatGPT sign-in", async () => {
  const fake = await startFakeOpenAIAuth() as Fake;
  const { db, sqlite } = database();
  const { createRouteHandler, HubCoordinator } = await import("./worker.js");
  const { OrganizationService } = await import("./organizations.js");
  const { D1OrganizationStore } = await import("./organization-store.js");
  let userId = "ada", clientKind = "web";
  const objects = new Map<string, InstanceType<typeof HubCoordinator>>();
  const env = {
    DB: db, AUTH_SECRET: { get: async () => SECRET }, BETTER_AUTH_URL: "https://hub.example", CHATGPT_AUTH_ISSUER: fake.url,
    COORDINATOR: { idFromName: (name: string) => name, get: (name: string) => {
      if (!objects.has(name)) objects.set(name, new HubCoordinator(objectState(), env as never));
      return objects.get(name)!;
    } },
  };
  const organizations = new D1OrganizationStore(db);
  const route = createRouteHandler({
    accountService: () => ({ authenticate: async () => ({ userId, sessionId: "session", clientKind }) }) as never,
    organizationStore: () => organizations,
    organizationService: () => new OrganizationService(organizations),
  });
  const call = (path: string, method = "GET", origin = "https://hub.example") => route(new Request(`https://hub.example${path}`, { method, headers: { authorization: "Bearer test", origin } }), env as never);
  try {
    assert.deepEqual(await (await call("/api/chatgpt-account")).json(), { phase: "signedOut" });
    const started = await call("/api/chatgpt-account/start", "POST");
    assert.equal(started.status, 200);
    fake.approve({ email: "ada@chatgpt.test", accountId: "acct-ada" });
    const connected = await (await call("/api/chatgpt-account")).text();
    assert.equal(JSON.parse(connected).phase, "connected");
    assert.ok(!connected.includes("fake-refresh") && !connected.includes("acct-ada"), "the browser never sees tokens");
    assert.notEqual((await call("/api/chatgpt-account/tokens", "POST")).status, 200, "the token route is not a browser route");
    assert.equal((await call("/api/chatgpt-account/start")).status, 405);
    assert.equal((await call("/api/chatgpt-account/start", "POST", "https://foreign.example")).status, 403);
    const browserTokens = await call("/api/organizations/org/computers/codex-tokens", "POST");
    assert.ok(browserTokens.status === 401 || browserTokens.status === 403, "only a signed computer asks for task tokens");
    assert.ok(!(await browserTokens.text()).includes("acct-ada"));

    assert.deepEqual(await (await call("/api/organizations/org/chatgpt")).json(), { connected: true, enabled: true, personal: false, available: true });
    assert.equal((await call("/api/organizations/org/chatgpt", "DELETE")).status, 200);
    assert.equal(((await (await call("/api/organizations/org/chatgpt")).json()) as { available: boolean }).available, false);
    const personal = (await personalSpace(db, "ada")).id;
    assert.equal((await call(`/api/organizations/${personal}/chatgpt`, "DELETE")).status, 409, "Personal always uses your own sign-in");

    userId = "grace";
    assert.deepEqual(await (await call("/api/organizations/org/chatgpt")).json(), { connected: false, enabled: true, personal: false, available: false }, "a member sees only their own sign-in");
    assert.deepEqual(await (await call("/api/chatgpt-account")).json(), { phase: "signedOut" });

    clientKind = "computer";
    assert.equal((await call("/api/chatgpt-account/start", "POST")).status, 403);
    assert.equal((await call("/api/chatgpt-account")).status, 403);
    assert.equal((await call("/api/organizations/org/chatgpt")).status, 403);
  } finally {
    sqlite.close();
    await fake.close();
  }
});
