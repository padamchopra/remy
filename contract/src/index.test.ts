import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_VERSION, THREAD_MESSAGE_MAX_CHARACTERS, THREAD_REQUEST_MAX_BYTES, accountProfileSchema, decodeComputerConnectionKey, encodeComputerConnectionKey, computerCapabilitiesSchema, computerHeartbeatSchema, computerRegistrationInputSchema, computerToHubFrameSchema, deviceAuthorizationSchema, hubToComputerFrameSchema, organizationDeletionImpactSchema, organizationSchema, organizationWorkspaceSchema, parseHubHealth, tokenPairSchema, uptimeCheckFrameSchema } from "./index.js";

test("fits every valid thread message in a hub request", () => {
  const text = "\u0000".repeat(THREAD_MESSAGE_MAX_CHARACTERS);
  const body = JSON.stringify({ text, messageId: `u-${crypto.randomUUID()}`, attachmentIds: [] });
  assert.ok(Buffer.byteLength(body) > 96_000);
  assert.ok(Buffer.byteLength(body) <= THREAD_REQUEST_MAX_BYTES);
});

test("accepts a compatible hub health response", () => {
  const health = parseHubHealth({
    contractVersion: CONTRACT_VERSION,
    environment: "staging",
    release: "0123456789abcdef",
    status: "ok",
    dependencies: {
      database: "ready",
      coordinator: "ready",
      objectStore: "ready",
      queue: "ready",
      secrets: "ready",
    },
  });

  assert.equal(health.environment, "staging");
});

test("validates shared computer and uptime frames", () => {
  assert.equal(computerHeartbeatSchema.parse({
    computerId: "computer-1",
    availability: "available",
    observedAt: "2026-09-04T12:00:00.000Z",
  }).computerId, "computer-1");
  assert.equal(uptimeCheckFrameSchema.parse({
    contractVersion: CONTRACT_VERSION,
    kind: "uptime.check",
    checkedAt: "2026-09-04T12:00:00.000Z",
    environment: "production",
    release: "abc",
    status: "ok",
    statusCode: 200,
  }).status, "ok");
});

test("validates computer capabilities and multiplexed protocol frames", () => {
  const capabilities = { providers: [{ id: "codex", models: ["gpt-5.6-sol"] }], workspaces: [{ id: "w1", name: "Remy", path: "/src/remy", origin: "github.com/remy/remy" }], worktrees: true, terminals: true, emulator: false };
  assert.equal(computerRegistrationInputSchema.parse({ computerId: "b7ebfcbe-f2f4-4a1b-8707-3029fa65d14b", name: "Studio", platform: "darwin", daemonVersion: "1.2.3", protocol: { minimum: 1, maximum: 1 }, publicKey: "k".repeat(44), capabilities }).capabilities.workspaces[0]?.name, "Remy");
  assert.equal(computerToHubFrameSchema.parse({ kind: "heartbeat", availability: "available", observedAt: 1 }).kind, "heartbeat");
  // A computer released before Tasks was removed still says it syncs the board; the hub ignores that.
  assert.equal("boardSync" in computerToHubFrameSchema.parse({ kind: "hello", boardSync: true, protocolVersion: 1, daemonVersion: "0.1.0", capabilities }), false);
  assert.equal(hubToComputerFrameSchema.parse({ kind: "request", id: "r1", method: "GET", path: "/api/chats", headers: {}, body: "" }).kind, "request");
  assert.throws(() => hubToComputerFrameSchema.parse({ kind: "request", id: "r1", method: "GET", path: "https://other.example", headers: {}, body: "" }));
});

test("rejects incompatible hub health responses", () => {
  assert.throws(
    () => parseHubHealth({ contractVersion: "2", environment: "staging", release: "abc" }),
    /incompatible/,
  );
  assert.throws(
    () => parseHubHealth({ contractVersion: CONTRACT_VERSION, environment: "preview", release: "abc" }),
    /incompatible/,
  );
  assert.throws(
    () => parseHubHealth({ contractVersion: CONTRACT_VERSION, environment: "production", release: "" }),
    /incompatible/,
  );
});

test("validates account, token, and device authorization contracts", () => {
  assert.equal(tokenPairSchema.parse({ tokenType: "Bearer", accessToken: "a".repeat(43), refreshToken: "b".repeat(43), expiresIn: 900 }).expiresIn, 900);
  assert.equal(deviceAuthorizationSchema.parse({ deviceCode: "c".repeat(43), userCode: "ABCD-2345", expiresIn: 600, interval: 5 }).interval, 5);
  assert.equal(accountProfileSchema.parse({ id: "user-1", name: "Ada", email: "ada@example.com", emailVerified: true, verifiedEmails: ["ada@example.com"] }).name, "Ada");
});

test("validates organization membership and deletion contracts", () => {
  assert.equal(organizationSchema.parse({ id: "org-1", name: "Acme", role: "owner", createdAt: 1, updatedAt: 1 }).role, "owner");
  assert.equal(organizationDeletionImpactSchema.parse({ organizationId: "org-1", name: "Acme", members: 2, teams: 1, invites: 1, workspaces: 3, deletes: ["memberships"] }).workspaces, 3);
});

test("validates organization workspaces, which carry no per-workspace access", () => {
  const workspace = { id: "workspace-1", organizationId: "org-1", name: "Remy", origin: "github.com/padam/remy", createdAt: 1, updatedAt: 1 };
  assert.equal(organizationWorkspaceSchema.parse(workspace).origin, "github.com/padam/remy");
  assert.equal("restricted" in organizationWorkspaceSchema.parse({ ...workspace, restricted: true }), false);
});

test("carries one connection key from the web to a computer's terminal", () => {
  const key = encodeComputerConnectionKey({ v: 1, url: "https://app.example.test", organizationId: "org-1", ownership: "personal", key: "a".repeat(43) });
  assert.match(key, /^remy_[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeComputerConnectionKey(` ${key}\n`), { v: 1, url: "https://app.example.test", organizationId: "org-1", ownership: "personal", key: "a".repeat(43) });

  assert.throws(() => decodeComputerConnectionKey("a".repeat(43)), /not a Remy connection key/);
  assert.throws(() => decodeComputerConnectionKey("remy_notbase64!!"), /incomplete/);
  assert.throws(() => decodeComputerConnectionKey(`remy_${btoa('{"v":1}').replace(/=+$/, "")}`), /incomplete/);
  assert.throws(() => encodeComputerConnectionKey({ v: 1, url: "not-a-url", organizationId: "org-1", ownership: "personal", key: "a".repeat(43) }));
});

test("computer capabilities carry model names and still accept ids alone", () => {
  const base = { workspaces: [], worktrees: true, terminals: true, emulator: false };
  const named = computerCapabilitiesSchema.parse({ ...base, providers: [{ id: "claude", models: ["sonnet"], modelInfo: [{ value: "sonnet", label: "Sonnet 5", context: "200K" }] }] });
  assert.equal(named.providers[0]?.modelInfo?.[0]?.label, "Sonnet 5");
  const bare = computerCapabilitiesSchema.parse({ ...base, providers: [{ id: "claude", models: ["sonnet"] }] });
  assert.equal(bare.providers[0]?.modelInfo, undefined);
});

test("review agent inputs keep findings anchored and rules short", async () => {
  const { hubReviewSchema, reviewFindingsReportSchema, reviewRuleInputSchema, reviewRuleProposalInputSchema, reviewStartSchema } = await import("./index.js");
  assert.deepEqual(reviewStartSchema.parse({ repository: "Release/Remy", number: 7 }), { repository: "release/remy", number: 7 });
  assert.equal(reviewStartSchema.safeParse({ repository: "release", number: 7 }).success, false);
  const report = reviewFindingsReportSchema.parse({ commit: "A4F91C2", findings: [{ path: "web/a.ts", startLine: 3, endLine: 4, severity: "must", title: "Searches on every keystroke", body: "Debounce it." }] });
  assert.equal(report.commit, "a4f91c2");
  assert.equal(report.findings[0]!.side, "RIGHT");
  assert.equal(reviewFindingsReportSchema.safeParse({ commit: "a4f91c2", findings: [{ path: "a", startLine: 5, endLine: 4, severity: "note", title: "t", body: "b" }] }).success, false);
  assert.equal(reviewFindingsReportSchema.safeParse({ commit: "not-a-sha", findings: [] }).success, false);
  assert.equal(reviewRuleInputSchema.safeParse({ text: "x".repeat(501), repository: null }).success, false);
  assert.equal(reviewRuleProposalInputSchema.safeParse({ text: "Rule", scope: "everywhere", reason: "r" }).success, false);
  assert.deepEqual(hubReviewSchema.parse({ repository: "release/remy", number: 7, title: "t", baseRef: "main", headRef: "b", headSha: "a".repeat(40), rules: [] }).stack, []);
});
