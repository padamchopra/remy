import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

const info = JSON.parse(readFileSync(process.env.QA_SESSION, "utf8"));
const base = `${info.hubUrl}/api/organizations/${info.organizationId}`;
const headers = { authorization: `Bearer ${info.tokens.ada}`, "content-type": "application/json" };
const call = async (path, method = "GET", body) => {
  const response = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return data;
};
const computers = await call("/computers");
const workspaceId = computers.computers.find(c => c.computerId === info.computerId).capabilities.workspaces[0].id;
const thread = await call(`/computers/${info.computerId}/threads`, "POST", { workspaceId, title: "Retain the opening message" });
const path = `/computers/${info.computerId}/threads/${thread.id}`;
const control = async action => {
  const response = await fetch(info.controlUrl + action, { method: "POST", headers: { authorization: `Bearer ${info.controlToken}` } });
  assert.equal(response.status, 204);
};
try {
  const messageId = `u-${crypto.randomUUID()}`;
  await call(path + "/message", "POST", { text: "Keep opening message through tool activity", messageId });
  let snapshot;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    snapshot = await call(path);
    if (snapshot.detail.state === "idle" && snapshot.detail.entries.some(e => e.kind === "assistant")) break;
    await wait(100);
  }
  assert.equal(snapshot.detail.state, "idle");
  assert.equal(snapshot.detail.history.hasEarlier, true);
  const ids = snapshot.detail.entries.map(e => e.id);
  let history = snapshot.detail.history;
  let pages = 0;
  while (history?.hasEarlier) {
    assert.ok(pages++ < 20, "History pagination must terminate");
    const page = await call(path + `/transcript?before=${encodeURIComponent(history.before)}`);
    ids.unshift(...page.entries.map(e => e.id));
    history = page.history;
  }
  assert.equal(ids[0], messageId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length > 500);
  await control("/disconnect");
  let stale;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    stale = await call(path);
    if (stale.stale) break;
    await wait(100);
  }
  assert.equal(stale.stale, true);
  assert.equal(stale.detail.history.hasEarlier, true);
  await control("/reconnect");
  let reconnected;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    reconnected = await call(path);
    if (!reconnected.stale) break;
    await wait(100);
  }
  assert.notEqual(reconnected.stale, true);
  const oldest = await call(path + `/transcript?before=${encodeURIComponent(ids[1])}`);
  assert.equal(oldest.entries[0].id, messageId);
  console.log(`Thread history passed: ${ids.length} retained entries, ${pages} earlier pages, opening message present without duplicates.`);
} finally {
  await control("/reconnect");
  await call(path, "DELETE");
}
