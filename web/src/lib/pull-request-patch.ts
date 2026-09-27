import type { PullRequestDiffHunk, PullRequestDiffLine } from "@/state/types";

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/// GitHub's per-file `patch` is a unified diff without the file header, so it
/// becomes the same hunks a computer's own diff does and draws the same way.
export function parsePullRequestPatch(patch: string): PullRequestDiffHunk[] {
  const hunks: PullRequestDiffHunk[] = [];
  let hunk: PullRequestDiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      hunk = { header: raw, lines: [] };
      hunks.push(hunk);
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    // "\ No newline at end of file" describes the line above it.
    if (!hunk || raw.startsWith("\\")) continue;
    const marker = raw[0];
    const text = raw.slice(1);
    let line: PullRequestDiffLine;
    if (marker === "+") line = { kind: "add", text, oldLine: null, newLine: newLine++ };
    else if (marker === "-") line = { kind: "del", text, oldLine: oldLine++, newLine: null };
    else line = { kind: "ctx", text: marker === " " ? text : raw, oldLine: oldLine++, newLine: newLine++ };
    hunk.lines.push(line);
  }
  // A trailing newline in the patch is not a context line.
  const last = hunks.at(-1)?.lines;
  if (last?.length && last.at(-1)!.kind === "ctx" && last.at(-1)!.text === "" && patch.endsWith("\n")) last.pop();
  return hunks;
}
