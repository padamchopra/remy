import assert from "node:assert/strict";
import test from "node:test";

import type { AccountStore, DeviceAuthorizationRecord, ProfileRecord, SessionRecord, SsoPolicy } from "./account-store.js";
import { AccountService, tokenHash, webSessionCookie } from "./accounts.js";
import { createRouteHandler, type Env } from "./worker.js";

class MemoryAccountStore implements AccountStore {
  sessions: SessionRecord[] = [];
  devices: DeviceAuthorizationRecord[] = [];
  profiles = new Map<string, ProfileRecord>();
  policies = new Map<string, SsoPolicy>();

  async createSession(session: SessionRecord) { this.sessions.push(structuredClone(session)); }
  async sessionByAccessHash(hash: string) { return this.sessions.find((item) => item.accessTokenHash === hash); }
  async sessionByRefreshHash(hash: string) { return this.sessions.find((item) => item.refreshTokenHash === hash); }
  async rotateSession(id: string, currentRefreshHash: string, values: Pick<SessionRecord, "accessTokenHash" | "refreshTokenHash" | "accessExpiresAt" | "refreshExpiresAt" | "lastSeenAt">) {
    const session = this.sessions.find((item) => item.id === id && item.refreshTokenHash === currentRefreshHash && !item.revokedAt);
    if (!session) return false;
    Object.assign(session, values);
    return true;
  }
  async revokeSession(id: string, at: number) { this.sessions.find((item) => item.id === id)!.revokedAt = at; }
  async revokeSessions(userId: string, at: number) { this.sessions.filter((item) => item.userId === userId && !item.revokedAt).forEach((item) => { item.revokedAt = at; }); }
  async sessionsFor(userId: string) { return this.sessions.filter((item) => item.userId === userId); }
  async createDeviceAuthorization(record: DeviceAuthorizationRecord) { this.devices.push(structuredClone(record)); }
  async deviceAuthorizationByDeviceHash(hash: string) { return this.devices.find((item) => item.deviceCodeHash === hash); }
  async deviceAuthorizationByUserHash(hash: string) { return this.devices.find((item) => item.userCodeHash === hash); }
  async updateDeviceAuthorization(id: string, patch: Partial<DeviceAuthorizationRecord>) { Object.assign(this.devices.find((item) => item.id === id)!, patch); }
  async consumeDeviceAuthorization(id: string, at: number) {
    const device = this.devices.find((item) => item.id === id && !item.consumedAt && !item.deniedAt && item.approvedUserId && item.expiresAt > at);
    if (!device) return false;
    device.consumedAt = at;
    return true;
  }
  async profile(userId: string) { return this.profiles.get(userId); }
  async updateProfile(userId: string, patch: { name?: string; image?: string | null }) {
    const profile = this.profiles.get(userId)!;
    if (patch.name !== undefined) profile.name = patch.name;
    if (patch.image === null) delete profile.image;
    else if (patch.image !== undefined) profile.image = patch.image;
    return profile;
  }
  async ssoPolicyForDomain(domain: string) { return this.policies.get(domain.toLowerCase()); }
}

function deterministicRandom() {
  let value = 0;
  return (bytes: number) => Uint8Array.from({ length: bytes }, () => ++value % 256);
}

function env(): Env {
  return {
    AUTH_SECRET: { get: async () => "test-secret-with-at-least-thirty-two-characters" } as SecretsStoreSecret,
    BETTER_AUTH_URL: "https://hub.example",
    COORDINATOR: {} as DurableObjectNamespace,
    DB: {} as D1Database,
    ENVIRONMENT: "staging",
    JOBS: {} as Queue,
    OBJECTS: {} as R2Bucket,
    RELEASE: "test",
  };
}

test("stores only token hashes and rotates a native client's refresh credential", async () => {
  const store = new MemoryAccountStore();
  let now = 1_000;
  const service = new AccountService(store, () => now, deterministicRandom());
  const first = await service.createSession("person-1", "phone", "Padam’s iPhone");

  assert.ok(first.refreshToken);
  assert.equal(store.sessions[0].accessTokenHash, await tokenHash(first.accessToken));
  assert.equal(store.sessions[0].refreshTokenHash, await tokenHash(first.refreshToken));
  assert.doesNotMatch(JSON.stringify(store.sessions), new RegExp(first.accessToken));
  assert.doesNotMatch(JSON.stringify(store.sessions), new RegExp(first.refreshToken));

  now += 1_000;
  const second = await service.refresh(first.refreshToken);
  assert.ok(second?.refreshToken);
  assert.notEqual(second.accessToken, first.accessToken);
  assert.equal(await service.refresh(first.refreshToken), undefined, "a rotated refresh token is single-use");
  assert.equal((await service.authenticate(second.accessToken))?.userId, "person-1");
});

test("revoking everywhere signs out web and phone sessions", async () => {
  const store = new MemoryAccountStore();
  const service = new AccountService(store, () => 5_000, deterministicRandom());
  const web = await service.createSession("person-1", "web", "Safari");
  const phone = await service.createSession("person-1", "phone", "iPhone");

  await service.revokeEverywhere("person-1");

  assert.equal(await service.authenticate(web.accessToken), undefined);
  assert.equal(await service.authenticate(phone.accessToken), undefined);
  assert.equal(await service.refresh(phone.refreshToken!), undefined);
});

test("a device code can be approved once and returns a refreshable pair", async () => {
  const store = new MemoryAccountStore();
  let now = 10_000;
  const service = new AccountService(store, () => now, deterministicRandom());
  const authorization = await service.startDeviceAuthorization("cli", "MacBook Pro");

  assert.equal((await service.pollDevice(authorization.deviceCode)).status, "pending");
  assert.equal(await service.approveDevice("person-1", authorization.userCode.toLowerCase()), "approved");
  now += authorization.interval * 1_000;
  const result = await service.pollDevice(authorization.deviceCode);
  assert.equal(result.status, "approved");
  if (result.status === "approved") assert.ok(result.refreshToken);
  assert.equal((await service.pollDevice(authorization.deviceCode)).status, "expired");
});

test("an enforced verified domain rejects magic links before Better Auth", async () => {
  const store = new MemoryAccountStore();
  store.policies.set("example.com", { organizationId: "org-1", domain: "example.com", enforced: true, verified: true, providerId: "example-sso", protocol: "saml" });
  let reachedBetterAuth = false;
  const route = createRouteHandler({
    accountStore: () => store,
    betterAuth: async () => ({ handler: async () => { reachedBetterAuth = true; return new Response(null); } }) as never,
  });
  const response = await route(new Request("https://hub.example/api/auth/sign-in/magic-link", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "person@example.com" }),
  }), env());

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Use your organization’s single sign-on.", providerId: "example-sso" });
  assert.equal(reachedBetterAuth, false);
});

test("profile routes expose verified emails without credential material", async () => {
  const store = new MemoryAccountStore();
  store.profiles.set("person-1", { id: "person-1", name: "Padam", email: "padam@example.com", emailVerified: true, verifiedEmails: ["padam@example.com"] });
  const service = new AccountService(store, () => 30_000, deterministicRandom());
  const pair = await service.createSession("person-1", "web", "Web");
  const route = createRouteHandler({ accountStore: () => store, accountService: () => service });
  const response = await route(new Request("https://hub.example/api/profile", { headers: { cookie: `remy_session=${pair.accessToken}` } }), env());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "person-1", name: "Padam", email: "padam@example.com", emailVerified: true, verifiedEmails: ["padam@example.com"] });
  assert.match(webSessionCookie("secret"), /HttpOnly; SameSite=Lax/);
});

test("web callback sessions become HTTP-only hashed sessions", async () => {
  const store = new MemoryAccountStore();
  const service = new AccountService(store, () => 40_000, deterministicRandom());
  let signedOut = false;
  const route = createRouteHandler({
    accountStore: () => store,
    accountService: () => service,
    betterAuth: async () => ({
      api: {
        getSession: async () => ({ user: { id: "person-1" } }),
        signOut: async () => { signedOut = true; },
      },
    }) as never,
  });
  const response = await route(new Request("https://hub.example/api/sessions/web", { method: "POST", headers: { cookie: "better-auth.session_token=callback", "user-agent": "Safari" } }), env());

  assert.equal(response.status, 200);
  assert.equal(signedOut, true);
  assert.match(response.headers.get("set-cookie") ?? "", /^remy_session=.*HttpOnly; SameSite=Lax.*Secure$/);
  assert.equal(store.sessions[0].clientKind, "web");
  assert.doesNotMatch(JSON.stringify(store.sessions), /remy_session|callback/);
});
