import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { PullRequestGuide } from "./pull-request-guides.js";

const stateDir = mkdtempSync(join(tmpdir(), "remy-pull-request-guides-"));
process.env.MC_CONFIG_DIR = stateDir;
process.env.HOME = stateDir;

const {
  compactGuideHunks, flattenGuideHunks, parseGuideSteps, uncoveredGuideHunkIds,
  discoverPullRequestGuide, readSavedPullRequestGuide, pullRequestGuideContext, generatePullRequestGuide,
} = await import("./pull-request-guides.js");
const { db } = await import("./db.js");
const { acceptAnnouncement } = await import("./peers.js");

function savedGuide(number: number): PullRequestGuide {
  return {
    repository: "example/repo", number, provider: "codex", model: "gpt-5.4", effort: "low",
    createdAt: 1_700_000_000_000, commitShas: ["a".repeat(40)],
    commits: [{ sha: "a".repeat(40), title: "Add example", author: "example", committedAt: "2026-08-30" }],
    hunks: [{ id: "H1", path: "example.ts", header: "@@ -0,0 +1 @@", lines: [{ kind: "add", text: "example", oldLine: null, newLine: 1 }] }],
    steps: [{ id: "step1", title: "Read the example", summary: "This adds an example.", hunkIds: ["H1"] }],
    uncoveredHunkIds: [], questions: [],
  };
}

async function pairedServer(t: TestContext, id: string, handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  acceptAnnouncement({ deviceId: id, name: id, token: "test-peer-token", url: `http://127.0.0.1:${address.port}` });
  t.after(async () => {
    db.prepare("delete from peers where id = ?").run(id);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
}

test("reuses durable local guides without GitHub, a model, or peer discovery", async (t) => {
  let requests = 0;
  await pairedServer(t, "local-priority", (_req, res) => { requests++; res.end("{}"); });
  const guide = savedGuide(101);
  db.prepare("insert into pull_request_guides (repository, number, json, updated_at) values (?, ?, ?, ?)")
    .run(guide.repository, guide.number, JSON.stringify(guide), Date.now());

  assert.deepEqual(readSavedPullRequestGuide(guide.repository, guide.number), guide);
  assert.deepEqual(await discoverPullRequestGuide(guide.repository, guide.number), { guide });
  assert.deepEqual((await pullRequestGuideContext(guide.repository, guide.number)).guide, guide);
  assert.deepEqual(await generatePullRequestGuide({ repository: guide.repository, number: guide.number }), guide);
  assert.equal(requests, 0);
});

test("shares online lookup and returns the owner without copying its guide", async (t) => {
  const guide = savedGuide(102);
  let requests = 0;
  await pairedServer(t, "saved-owner", (req, res) => {
    requests++;
    assert.equal(req.headers.authorization, "Bearer test-peer-token");
    assert.equal(req.url, "/pull-requests/guide/saved?repository=example%2Frepo&number=102");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ guide }));
  });
  const [first, second] = await Promise.all([
    discoverPullRequestGuide(guide.repository, guide.number),
    discoverPullRequestGuide(guide.repository, guide.number),
  ]);
  assert.deepEqual(first, { guide, peerId: "saved-owner" });
  assert.deepEqual(second, first);
  assert.equal(requests, 1);
  assert.equal(readSavedPullRequestGuide(guide.repository, guide.number), undefined);
});

test("ignores offline, incompatible, wrong-PR, and malformed saved guides", async (t) => {
  let offlineRequests = 0;
  await pairedServer(t, "offline-owner", (_req, res) => { offlineRequests++; res.end("{}"); });
  db.prepare("update peers set last_seen = ? where id = ?").run(Date.now() - 120_000, "offline-owner");
  await pairedServer(t, "old-version", (_req, res) => { res.writeHead(404); res.end("{}"); });
  await pairedServer(t, "wrong-pr", (_req, res) => { res.end(JSON.stringify({ guide: savedGuide(999) })); });
  await pairedServer(t, "malformed", (_req, res) => {
    res.end(JSON.stringify({ guide: { ...savedGuide(103), steps: [{ title: "Incomplete step" }] } }));
  });

  assert.deepEqual(await discoverPullRequestGuide("example/repo", 103), {});
  assert.equal(offlineRequests, 0);
});

test("a slow online device does not hold up a matching guide", async (t) => {
  const guide = savedGuide(104);
  await pairedServer(t, "slow-owner", () => {});
  await pairedServer(t, "fast-owner", (_req, res) => { res.end(JSON.stringify({ guide })); });
  const start = Date.now();
  assert.deepEqual(await discoverPullRequestGuide(guide.repository, guide.number), { guide, peerId: "fast-owner" });
  assert.ok(Date.now() - start < 1_000);
});

test("silent online devices have a bounded lookup deadline", async (t) => {
  await pairedServer(t, "silent-owner", () => {});
  const start = Date.now();
  assert.deepEqual(await discoverPullRequestGuide("example/repo", 105), {});
  assert.ok(Date.now() - start < 4_000);
});

test("keeps each guided-review hunk in one model-authored step", () => {
  const steps = parseGuideSteps(JSON.stringify({
    steps: [
      { title: "Start with storage", summary: "Read the durable shape first.", hunks: ["H2", "H1", "H1"] },
      { title: "Then read the UI", summary: "See how the interface consumes it.", hunks: ["H1", "H3"] },
    ],
  }), ["H1", "H2", "H3"]);

  assert.deepEqual(steps.map((step) => ({ title: step.title, hunkIds: step.hunkIds })), [
    { title: "Start with storage", hunkIds: ["H2", "H1"] },
    { title: "Then read the UI", hunkIds: ["H3"] },
  ]);
  assert.deepEqual(uncoveredGuideHunkIds(steps, ["H1", "H2", "H3"]), []);
});

test("reports omitted hunks without asking the model to repair coverage", () => {
  const steps = parseGuideSteps("```json\n{\"steps\":[{\"title\":\"Core change\",\"summary\":\"Read this first.\",\"hunks\":[\"H1\"]}]}\n```", ["H1", "H2"]);

  assert.equal(steps.length, 1);
  assert.deepEqual(uncoveredGuideHunkIds(steps, ["H1", "H2"]), ["H2"]);
});

test("reports every hunk when the model returns invalid JSON", () => {
  const steps = parseGuideSteps("I could not format this.", ["H1", "H2"]);

  assert.equal(steps.length, 0);
  assert.deepEqual(uncoveredGuideHunkIds(steps, ["H1", "H2"]), ["H1", "H2"]);
});

test("compact guide input excludes context and bounds changed-line excerpts", () => {
  const input = compactGuideHunks([{
    id: "H1",
    path: "src/example.ts",
    header: "@@ -1,100 +1,100 @@",
    lines: [
      { kind: "ctx", text: "unchanged context", oldLine: 1, newLine: 1 },
      ...Array.from({ length: 100 }, (_, index) => ({
        kind: "add" as const,
        text: `added line ${index}`,
        oldLine: null,
        newLine: index + 2,
      })),
    ],
  }]);

  assert.ok(input.includes("### H1 src/example.ts"));
  assert.ok(input.includes("(+100 -0)"));
  assert.ok(!input.includes("unchanged context"));
  assert.ok(input.includes("76 more changed lines"));
  assert.ok(input.length < 2_000);
});

test("the prompt cap never removes a hunk from deterministic coverage", () => {
  const hunks = Array.from({ length: 100 }, (_, index) => ({
    id: `H${index + 1}`,
    path: `src/file-${index}.ts`,
    header: "@@ -1,24 +1,24 @@",
    lines: Array.from({ length: 24 }, (_, line) => ({
      kind: "add" as const,
      text: "a".repeat(80),
      oldLine: null,
      newLine: line + 1,
    })),
  }));
  const input = compactGuideHunks(hunks);
  const uncovered = uncoveredGuideHunkIds([], hunks.map((hunk) => hunk.id));

  assert.ok(input.length <= 80_000);
  assert.ok(!input.includes("### H100 "));
  assert.equal(uncovered.length, 100);
  assert.equal(uncovered.at(-1), "H100");
});

test("coverage includes binary and rename-only files without text hunks", () => {
  const hunks = flattenGuideHunks([
    { path: "image.png", hunks: [] },
    { path: "new-name.ts", previousPath: "old-name.ts", hunks: [] },
  ]);

  assert.equal(hunks[0]?.header, "No text preview");
  assert.equal(hunks[1]?.header, "Renamed from old-name.ts");
  assert.deepEqual(uncoveredGuideHunkIds([], hunks.map((hunk) => hunk.id)), ["H1", "H2"]);
});
