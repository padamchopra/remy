import type { PullRequestDiff, PullRequestDiffFile, PullRequestGuide, PullRequestGuideHunk } from "../state/types";

export function pullRequestFileStat(file: PullRequestDiffFile): { additions: number; deletions: number } {
  return file.hunks.flatMap((hunk) => hunk.lines).reduce((stat, line) => ({
    additions: stat.additions + Number(line.kind === "add"),
    deletions: stat.deletions + Number(line.kind === "del"),
  }), { additions: 0, deletions: 0 });
}

const fileKey = (hunk: PullRequestGuideHunk) => JSON.stringify([hunk.path, hunk.revision?.head, hunk.revision?.base]);
const sameHunk = (a: PullRequestGuideHunk, b: PullRequestDiffFile["hunks"][number]) => a.header === b.header && JSON.stringify(a.lines) === JSON.stringify(b.lines);

/// Context boundaries use every hunk in the file, including changes in other steps.
export function guideFileGroups(guide: PullRequestGuide, hunks: PullRequestGuideHunk[], current: PullRequestDiff) {
  const groups = new Map<string, PullRequestGuideHunk[]>();
  for (const hunk of hunks) {
    const key = fileKey(hunk);
    groups.set(key, [...(groups.get(key) ?? []), hunk]);
  }
  return [...groups].map(([key, selected]) => {
    const first = selected[0];
    const all = guide.hunks.filter((hunk) => fileKey(hunk) === key);
    const live = current.files.find((file) => file.path === first.path);
    const legacyMatch = !first.revision && live && all.every((hunk) => live.hunks.some((candidate) => sameHunk(hunk, candidate)));
    const file: PullRequestDiffFile = {
      path: first.path,
      previousPath: first.revision?.previousPath ?? (legacyMatch ? live.previousPath : undefined),
      deleted: first.revision?.deleted ?? (legacyMatch ? live.deleted : undefined),
      viewed: live?.viewed ?? false,
      hunks: legacyMatch ? live.hunks : all.filter((hunk) => hunk.lines.length > 0),
    };
    const selectedByIndex = new Map<number, PullRequestGuideHunk>();
    file.hunks.forEach((candidate, index) => {
      const hunk = selected.find((entry) => sameHunk(entry, candidate));
      if (hunk) selectedByIndex.set(index, hunk);
    });
    return {
      key, file, selectedByIndex, canMarkViewed: Boolean(live && current.nodeId),
      pullRequest: {
        ...current,
        headRefOid: first.revision?.head ?? (legacyMatch ? current.headRefOid : undefined),
        baseRefOid: first.revision?.base ?? (legacyMatch ? current.baseRefOid : undefined),
      },
    };
  });
}
