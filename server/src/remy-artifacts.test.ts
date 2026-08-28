import assert from "node:assert/strict";
import test from "node:test";
import { artifactMarker, takeArtifacts, type ConvArtifact } from "./remy-artifacts.js";

const ticket: ConvArtifact = { kind: "ticket", key: "REMY-12", title: "Rework the inbox", detail: "todo" };

test("a tool's answer keeps its sentence and hands the card over separately", () => {
  const result = takeArtifacts(`Created REMY-12 in Remy.${artifactMarker(ticket)}`);
  assert.equal(result.text, "Created REMY-12 in Remy.");
  assert.deepEqual(result.artifacts, [ticket]);
});

test("output with no marker comes back exactly as it was", () => {
  const plain = "total 4\ndrwxr-xr-x  3 you  staff  96 Aug 22 08:00 .";
  const result = takeArtifacts(plain);
  assert.equal(result.text, plain);
  assert.deepEqual(result.artifacts, []);
});

test("several things made in one call each get a card", () => {
  const thread: ConvArtifact = { kind: "thread", id: "abc", title: "Rework the inbox" };
  const routine: ConvArtifact = { kind: "routine", id: "routine-1", title: "Morning review" };
  const result = takeArtifacts(`Done.${artifactMarker(ticket)}${artifactMarker(thread)}${artifactMarker(routine)}`);
  assert.deepEqual(result.artifacts, [ticket, thread, routine]);
});

test("a marker Remy cannot read is dropped rather than drawn", () => {
  const result = takeArtifacts("Created it.\n<remy-artifact>{not json</remy-artifact>");
  assert.equal(result.text, "Created it.");
  assert.deepEqual(result.artifacts, []);
});

test("a card with no kind Remy draws, or no name to draw, is dropped", () => {
  const bogus = '<remy-artifact>{"kind":"invoice","title":"Nope"}</remy-artifact>'
    + '<remy-artifact>{"kind":"ticket"}</remy-artifact>';
  assert.deepEqual(takeArtifacts(`Hm.${bogus}`).artifacts, []);
});

test("a tool that made nothing says so with text alone", () => {
  const result = takeArtifacts("No workspaces are registered on this machine.");
  assert.deepEqual(result.artifacts, []);
  assert.equal(result.text, "No workspaces are registered on this machine.");
});
