import assert from "node:assert/strict";
import test from "node:test";
import { chatWindow } from "./chat-window.js";
import type { ConvEntry } from "./transcript.js";

function entry(id: string, kind: ConvEntry["kind"]): ConvEntry {
  return { id, kind, text: id };
}

const transcript = [
  entry("u1", "user"),
  entry("a1", "assistant"),
  entry("t1", "tool"),
  entry("u2", "user"),
  entry("a2", "assistant"),
  entry("u3", "user"),
  entry("thinking3", "thinking"),
  entry("t3", "tool"),
  entry("a3", "assistant"),
];

test("bounds the newest transcript by complete user turns", () => {
  const page = chatWindow(transcript, 2);
  assert.deepEqual(page.entries.map((item) => item.id), ["u2", "a2", "u3", "thinking3", "t3", "a3"]);
  assert.deepEqual(page.history, { hasEarlier: true, before: "u2" });
});

test("loads the preceding complete turns from the first visible entry", () => {
  const page = chatWindow(transcript, 2, "u2");
  assert.deepEqual(page.entries.map((item) => item.id), ["u1", "a1", "t1"]);
  assert.deepEqual(page.history, { hasEarlier: false });
});

test("does not split a large turn to satisfy a raw entry count", () => {
  const entries = [entry("u1", "user"), ...Array.from({ length: 120 }, (_, index) => entry(`t${index}`, "tool"))];
  assert.equal(chatWindow(entries, 1).entries.length, 121);
});

test("bounds a transcript tail that contains no user turn", () => {
  const entries = Array.from({ length: 120 }, (_, index) => entry(`a${index}`, "assistant"));
  const page = chatWindow(entries, 12);
  assert.equal(page.entries.length, 48);
  assert.deepEqual(page.history, { hasEarlier: true, before: "a72" });
});

test("rejects an expired history cursor", () => {
  assert.throws(() => chatWindow(transcript, 2, "gone"), /cursor/);
});

test("drops older complete turns when the initial transfer exceeds its byte budget", () => {
  const entries = [
    { ...entry("u1", "user"), text: "x".repeat(80) },
    { ...entry("a1", "assistant"), text: "x".repeat(80) },
    entry("u2", "user"),
    entry("a2", "assistant"),
  ];
  const page = chatWindow(entries, 2, undefined, 100);
  assert.deepEqual(page.entries.map((item) => item.id), ["u2", "a2"]);
  assert.deepEqual(page.history, { hasEarlier: true, before: "u2" });
});
