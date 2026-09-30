// The fixture model's review agent, for the disposable QA hub. It exercises
// the real path a model would: the review thread's own in-process Remy tools,
// the computer's hub call and the hub's diff and ownership checks. Only the
// judgement is canned.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);

export const isReviewThread = (instructions) => !!instructions?.includes("## You are reviewing a pull request");

/// The first line the pull request adds, from `git diff --unified=0`: a
/// finding there sits inside a hunk on the RIGHT side, as the hub requires.
export function firstAddedLine(diff) {
  let path;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) path = line === "+++ /dev/null" ? undefined : line.slice(4).replace(/^b\//, "");
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (path && hunk && (hunk[2] === undefined || Number(hunk[2]) > 0))
      return { path, line: Number(hunk[1]) };
  }
  return undefined;
}

/// What kind of turn a review message asks for.
export function reviewTurn(prompt) {
  const flagged = /I flagged your finding ".*" at \S+ \(finding ([^)]+)\)\./.exec(prompt);
  if (flagged) return { kind: "flag", findingId: flagged[1] };
  if (/Review pull request #\d+ /.test(prompt) || /Review the commits after [0-9a-f]{7,40} up to [0-9a-f]{7,40}\./i.test(prompt))
    return { kind: "report" };
  return { kind: "reply" };
}

/// Runs one fixture review turn and returns the assistant's reply.
export async function fixtureReviewTurn({ cwd, developerInstructions, inProcessMcp, prompt, event }) {
  const turn = reviewTurn(prompt);
  if (turn.kind === "reply") return "I’ll keep that in mind for the rest of this review.";
  const { Client } = await import("../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js");
  const { InMemoryTransport } = await import("../../server/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js");
  const { applyToolOutput } = await import("../../server/dist/transcript.js");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "Disposable review fixture", version: "1" });
  await inProcessMcp.instance.connect(serverSide);
  await client.connect(clientSide);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.[0]?.text ?? "";
    const entry = { id: randomUUID(), kind: "tool", tool: name };
    applyToolOutput(entry, text, 10000);
    event({ type: "entry.updated", entry });
    if (result.isError) throw new Error(text.split("\n<remy-artifact>")[0] || `${name} failed`);
    return text;
  };
  try {
    if (turn.kind === "flag") {
      await call("propose_review_rule", {
        text: "Call out a one-word change that shifts what a sentence means.",
        scope: "repository",
        reason: "You flagged a finding about a single swapped word.",
        findingId: turn.findingId,
      });
      return "I proposed a rule from your flag. Save it, edit it or discard it.";
    }
    const base = /git diff origin\/(\S+?)\.\.\.HEAD/.exec(developerInstructions ?? "")?.[1];
    if (!base) throw new Error("The review instructions name no base branch");
    const commit = (await run("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim();
    const diff = (await run("git", ["-C", cwd, "diff", "--unified=0", `origin/${base}...HEAD`], { maxBuffer: 16 * 1024 * 1024 })).stdout;
    const anchor = firstAddedLine(diff);
    return anchor ? `I read commit ${commit.slice(0, 12)}. Should fix: check ${anchor.path}:${anchor.line}, the first changed line.` : "I read the diff and found nothing to flag.";
  } finally {
    await client.close();
  }
}
