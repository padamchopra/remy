/// GitHub is where Remy ships. The window compares the version it was built
/// from to the latest published release, so a machine running an old copy says
/// so.

export const REMY_VERSION = import.meta.env.VITE_REMY_VERSION ?? "0.1.0";
export const REMY_REPO = "padamchopra/remy";

export interface RemyRelease {
  version: string;
  notes?: string;
  pageUrl: string;
}

export function isLocalBuild(version: string): boolean {
  if (import.meta.env.DEV) return true;
  return (parts(version)[2] ?? 0) === 0;
}

export function isNewer(latest: string, current: string): boolean {
  const left = parts(latest);
  const right = parts(current);
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  return false;
}

/// How much of one release's notes the card shows. A run of releases is worth
/// reading at a glance; the whole of each one is what the release page is for.
const MAX_NOTE_LINES = 8;

/// Whether a line of GitHub's generated notes is its furniture rather than
/// news: the heading it adds, the contributors section, and the compare link.
function isBoilerplate(line: string): boolean {
  const text = line.replace(/[*#]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return (
    text === ""
    || text === "what's changed"
    || text === "whats changed"
    || text === "new contributors"
    || text.startsWith("full changelog")
    || line.includes("/compare/")
  );
}

/// GitHub's generated notes name the author and link the PR on every line,
/// which is most of the width and none of the news.
export function summarizeNotes(notes: string | undefined): string | undefined {
  if (!notes) return undefined;
  const lines = notes
    .split("\n")
    .filter((line) => !isBoilerplate(line))
    .map((line) => line.replace(/\s+by\s+@[\w-]+\s+in\s+https?:\/\/\S+/i, "").trimEnd());

  const kept = lines.slice(0, MAX_NOTE_LINES);
  if (lines.length > kept.length) kept.push(`* …and ${lines.length - kept.length} more`);
  return kept.join("\n").trim() || undefined;
}

/// Every release newer than `current`, newest first — what you would be getting,
/// not just what the newest one changed.
export async function fetchReleasesSince(current: string): Promise<RemyRelease[]> {
  const response = await fetch(`https://api.github.com/repos/${REMY_REPO}/releases?per_page=30`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `Remy/${REMY_VERSION}` },
  });
  if (!response.ok) throw new Error("Couldn't reach the update feed.");
  const body = (await response.json()) as {
    tag_name?: string;
    html_url?: string;
    body?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: { name?: string; browser_download_url?: string }[];
  }[];

  return body
    .filter((entry) => !entry.draft && !entry.prerelease)
    .map((entry) => toRelease(entry))
    .filter((release): release is RemyRelease => Boolean(release) && isNewer(release!.version, current))
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : 1));
}

function toRelease(
  body: { tag_name?: string; html_url?: string; body?: string },
): RemyRelease | undefined {
  const version = (body.tag_name ?? "").replace(/^v/i, "").trim();
  if (!version) return undefined;
  return {
    version,
    notes: body.body?.trim() || undefined,
    pageUrl: body.html_url || `https://github.com/${REMY_REPO}/releases/latest`,
  };
}

export async function fetchLatestRelease(): Promise<RemyRelease | undefined> {
  const response = await fetch(`https://api.github.com/repos/${REMY_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `Remy/${REMY_VERSION}` },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error("Couldn't reach the update feed.");
  const body = (await response.json()) as { tag_name?: string; html_url?: string; body?: string };
  return toRelease(body);
}

function parts(version: string): number[] {
  return version
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((piece) => Number.parseInt(piece, 10) || 0);
}
