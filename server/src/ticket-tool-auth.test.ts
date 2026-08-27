import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.MC_CONFIG_DIR = mkdtempSync(join(tmpdir(), "remy-ticket-auth-"));
const { isRemyToolRoute, remyToolChatId, remyToolToken } = await import("./ticket-tool-auth.js");

test("a Remy capability names only the thread it was minted for", () => {
  const token = remyToolToken("chat-1");
  assert.equal(remyToolChatId(`Bearer ${token}`), "chat-1");
  assert.equal(remyToolChatId(`Bearer ${token}changed`), undefined);
  assert.equal(remyToolChatId("Bearer not-a-remy-token"), undefined);
});

test("a Remy capability reaches orchestration without reaching administration", () => {
  assert.equal(isRemyToolRoute("GET", "/board"), true);
  assert.equal(isRemyToolRoute("POST", "/tickets/one/comment"), true);
  assert.equal(isRemyToolRoute("POST", "/tickets/one/status"), true);
  assert.equal(isRemyToolRoute("PATCH", "/tickets/one/comments/two"), false);
  assert.equal(isRemyToolRoute("DELETE", "/tickets/one/comments/two"), false);
  assert.equal(isRemyToolRoute("PATCH", "/tickets/one"), true);
  assert.equal(isRemyToolRoute("GET", "/workspaces"), true);
  assert.equal(isRemyToolRoute("POST", "/workspaces"), true);
  assert.equal(isRemyToolRoute("POST", "/runtime/environment-command"), true);
  assert.equal(isRemyToolRoute("POST", "/chats"), true);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-2/message"), true);
  assert.equal(isRemyToolRoute("GET", "/chats/chat-1/browser"), true);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-1/browser/click"), true);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-1/browser/viewport"), true);
  assert.equal(isRemyToolRoute("DELETE", "/chats/chat-1/browser"), false);
  assert.equal(isRemyToolRoute("POST", "/tickets/one/start"), false);
  assert.equal(isRemyToolRoute("DELETE", "/tickets/one"), false);
  assert.equal(isRemyToolRoute("DELETE", "/chats/chat-1"), false);
  assert.equal(isRemyToolRoute("PATCH", "/workspaces/one"), false);
  assert.equal(isRemyToolRoute("GET", "/projects/one/environments"), false);
  assert.equal(isRemyToolRoute("PATCH", "/server/settings"), false);
  // The inbox is the person's, not an agent's: an agent may read the roster
  // but may not open somebody's conversation with one, or mark it read.
  assert.equal(isRemyToolRoute("GET", "/agents"), true);
  assert.equal(isRemyToolRoute("GET", "/agents/one/memories"), true);
  assert.equal(isRemyToolRoute("POST", "/agents/one/memories"), true);
  assert.equal(isRemyToolRoute("PATCH", "/agents/one/memories/memory-one"), true);
  assert.equal(isRemyToolRoute("DELETE", "/agents/one/memories/memory-one"), true);
  assert.equal(isRemyToolRoute("DELETE", "/agents/one/memories"), false);
  assert.equal(isRemyToolRoute("POST", "/agents/one/memories/memory-one"), false);
  assert.equal(isRemyToolRoute("POST", "/agents/one/dm"), false);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-2/read"), false);
  assert.equal(isRemyToolRoute("POST", "/agents"), false);
  assert.equal(isRemyToolRoute("DELETE", "/agents/one"), false);
});
