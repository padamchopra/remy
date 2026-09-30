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

test("a review thread's capability reaches its review rule tool and nothing beside them", () => {
  assert.equal(isRemyToolRoute("POST", "/organization-tools/report_review_findings"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/propose_review_rule"), true);
  // Deciding on findings and rules is the person's, in Remy.
  assert.equal(isRemyToolRoute("GET", "/organization-tools/report_review_findings"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/accept_review_rule"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/save_review_rule"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/dismiss_review_finding"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/report_review_findings/extra"), false);
  assert.equal(isRemyToolRoute("PATCH", "/organization-tools/propose_review_rule"), false);
  assert.equal(isRemyToolRoute("POST", "/review-rules"), false);
});

test("a Remy capability reaches orchestration without reaching administration", () => {
  assert.equal(isRemyToolRoute("POST", "/organization-tools/github_action"), true);
  // Tasks are gone, so neither Remy's own tickets nor Linear's ticket mirror
  // are a capability.
  assert.equal(isRemyToolRoute("POST", "/organization-tools/resolve_linear_ticket"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/comment_organization_ticket"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/create_organization_ticket"), false);
  assert.equal(isRemyToolRoute("GET", "/board"), false);
  assert.equal(isRemyToolRoute("POST", "/tickets"), false);
  assert.equal(isRemyToolRoute("POST", "/tickets/one/comment"), false);
  assert.equal(isRemyToolRoute("POST", "/tickets/one/status"), false);
  assert.equal(isRemyToolRoute("PATCH", "/tickets/one"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/configure_linear"), false);
  assert.equal(isRemyToolRoute("GET", "/server/linear"), false);
  assert.equal(isRemyToolRoute("POST", "/server/linear/accounts"), false);
  assert.equal(isRemyToolRoute("DELETE", "/server/linear/accounts/one"), false);
  assert.equal(isRemyToolRoute("PUT", "/server/linear/link"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/github_installation"), false);
  assert.equal(isRemyToolRoute("GET", "/organization-tools/github_action"), false);
  assert.equal(isRemyToolRoute("POST", "/server/update/shutdown"), false);
  assert.equal(isRemyToolRoute("PATCH", "/tickets/one/comments/two"), false);
  assert.equal(isRemyToolRoute("DELETE", "/tickets/one/comments/two"), false);
  assert.equal(isRemyToolRoute("GET", "/workspaces"), true);
  assert.equal(isRemyToolRoute("GET", "/pull-requests/stack"), false);
  assert.equal(isRemyToolRoute("POST", "/pull-requests/stack"), false);
  assert.equal(isRemyToolRoute("GET", "/pull-requests/file"), false);
  assert.equal(isRemyToolRoute("POST", "/pull-requests/file"), false);
  assert.equal(isRemyToolRoute("GET", "/pull-requests/questions"), false);
  assert.equal(isRemyToolRoute("GET", "/pull-requests/questions/discover"), false);
  assert.equal(isRemyToolRoute("POST", "/pull-requests/questions"), false);
  assert.equal(isRemyToolRoute("POST", "/pull-requests/merge"), false);
  assert.equal(isRemyToolRoute("POST", "/workspaces"), true);
  assert.equal(isRemyToolRoute("POST", "/runtime/environment-command"), true);
  assert.equal(isRemyToolRoute("PATCH", "/routines/one"), false);
  assert.equal(isRemyToolRoute("POST", "/chats"), false);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-2/message"), false);
  assert.equal(isRemyToolRoute("GET", "/chats/chat-1/browser"), true);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-1/browser/click"), true);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-1/browser/viewport"), true);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-1/browser/reload"), true);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-1/browser/zoom"), true);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-1/browser/unknown"), false);
  assert.equal(isRemyToolRoute("DELETE", "/chats/chat-1/browser"), false);
  assert.equal(isRemyToolRoute("POST", "/tickets/one/start"), false);
  assert.equal(isRemyToolRoute("DELETE", "/tickets/one"), false);
  assert.equal(isRemyToolRoute("DELETE", "/chats/chat-1"), false);
  assert.equal(isRemyToolRoute("PATCH", "/chats/chat-1"), false);
  assert.equal(isRemyToolRoute("GET", "/chats/chat-1"), false);
  assert.equal(isRemyToolRoute("GET", "/chats/chat-1/pull-request"), false);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-1/archive"), false);
  assert.equal(isRemyToolRoute("PATCH", "/workspaces/one"), false);
  assert.equal(isRemyToolRoute("GET", "/workspaces/one/dirty"), false);
  assert.equal(isRemyToolRoute("POST", "/workspaces/one/worktrees/close"), false);
  assert.equal(isRemyToolRoute("GET", "/projects/one/environments"), false);
  assert.equal(isRemyToolRoute("PATCH", "/server/settings"), false);
  assert.equal(isRemyToolRoute("POST", "/server/automatic-update"), false);
  assert.equal(isRemyToolRoute("PATCH", "/server/app-update"), false);
  // Agents and routing are gone, so their routes are not a capability either.
  assert.equal(isRemyToolRoute("GET", "/agents"), false);
  assert.equal(isRemyToolRoute("POST", "/agents/one/memories"), false);
  assert.equal(isRemyToolRoute("POST", "/routines"), false);
  assert.equal(isRemyToolRoute("GET", "/routing"), false);
  assert.equal(isRemyToolRoute("PUT", "/routing"), false);
  assert.equal(isRemyToolRoute("POST", "/chats/chat-2/read"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/explain_routing"), false);
  assert.equal(isRemyToolRoute("POST", "/organization-tools/create_organization_routine"), false);
  assert.equal(isRemyToolRoute("POST", "/agents"), false);
  assert.equal(isRemyToolRoute("DELETE", "/agents/one"), false);
});

test("thread orchestration reaches hub actions and cannot bypass access through local thread routes", () => {
  for (const action of ["list_threads","read_thread","start_thread","send_to_thread","stop_thread"]) {
    assert.equal(isRemyToolRoute("POST", `/organization-tools/${action}`), true);
    assert.equal(isRemyToolRoute("GET", `/organization-tools/${action}`), false);
  }
  for (const [method,path] of [["GET","/chats"],["POST","/chats"],["POST","/chats/other/message"],["POST","/chats/other/stop"]]) assert.equal(isRemyToolRoute(method,path),false);
  assert.equal(isRemyToolRoute("POST","/organization-tools/delete_thread"),false);
});
