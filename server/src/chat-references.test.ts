import assert from "node:assert/strict";
import test from "node:test";
import { codeReferencePrompt, validateChatCodeReferences } from "./chat-references.js";

test("code references validate and become agent context", () => {
  const references = validateChatCodeReferences([{
    id: "ref-1",
    path: "Sources/Inbox.kt",
    startLine: 14,
    endLine: 15,
    comment: "Keep this state stable.",
    lines: [
      { kind: "del", oldLine: 14, newLine: null, text: "old value" },
      { kind: "add", oldLine: null, newLine: 15, text: "new value" },
    ],
  }]);

  assert.equal(references[0].path, "Sources/Inbox.kt");
  assert.match(codeReferencePrompt(references), /Sources\/Inbox\.kt \(L14-15\)/);
  assert.match(codeReferencePrompt(references), /Comment: Keep this state stable\./);
});

test("code references reject missing comments", () => {
  assert.throws(() => validateChatCodeReferences([{
    id: "ref-1",
    path: "Sources/Inbox.kt",
    startLine: 14,
    endLine: 14,
    lines: [{ kind: "ctx", oldLine: 14, newLine: 14, text: "value" }],
  }]), /incomplete/);
});
