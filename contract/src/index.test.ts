import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_VERSION, accountProfileSchema, computerHeartbeatSchema, deviceAuthorizationSchema, organizationDeletionImpactSchema, organizationSchema, organizationWorkspaceSchema, parseHubHealth, tokenPairSchema, uptimeCheckFrameSchema } from "./index.js";

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

test("validates organization workspaces and optional administrative access", () => {
  const workspace = { id: "workspace-1", organizationId: "org-1", name: "Remy", origin: "github.com/padam/remy", restricted: true, createdAt: 1, updatedAt: 1 };
  assert.equal(organizationWorkspaceSchema.parse(workspace).restricted, true);
  assert.deepEqual(organizationWorkspaceSchema.parse({ ...workspace, access: { teamIds: ["team-1"], userIds: [] } }).access?.teamIds, ["team-1"]);
});
