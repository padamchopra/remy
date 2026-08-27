/// The things a Remy tool made, carried out of the tool result so the feed can
/// show them as cards instead of a line of prose.
///
/// The marker travels inside the tool's own text rather than beside it. Every
/// provider gets Remy's tools a different way — in-process for Claude, over
/// STDIO for Codex and Cursor — and a transcript is the one thing all three
/// write down the same way. It is stripped before the text reaches the feed;
/// the model still reads it on its next turn, which costs a line and tells it
/// exactly what it just made.

export interface ConvArtifact {
  kind: "ticket" | "thread" | "workspace" | "routine";
  /// A ticket is addressed by key, a thread and a workspace by id. Whichever
  /// one this has is what opens it.
  key?: string;
  id?: string;
  title: string;
  /// One line under the title: a ticket's status, a thread's folder.
  detail?: string;
}

const OPEN = "<remy-artifact>";
const CLOSE = "</remy-artifact>";
// A tool that made a hundred things is a tool that went wrong, and a feed is
// not where that is worth rendering.
const MAX_ARTIFACTS = 8;

/// The line a Remy tool appends to say what it made.
export function artifactMarker(artifact: ConvArtifact): string {
  return `\n${OPEN}${JSON.stringify(artifact)}${CLOSE}`;
}

function parse(json: string): ConvArtifact | undefined {
  try {
    const value = JSON.parse(json) as Record<string, unknown>;
    const kind = value.kind;
    if (kind !== "ticket" && kind !== "thread" && kind !== "workspace" && kind !== "routine") return undefined;
    const title = typeof value.title === "string" ? value.title.slice(0, 200) : "";
    if (!title) return undefined;
    return {
      kind,
      title,
      ...(typeof value.key === "string" ? { key: value.key.slice(0, 60) } : {}),
      ...(typeof value.id === "string" ? { id: value.id.slice(0, 200) } : {}),
      ...(typeof value.detail === "string" && value.detail ? { detail: value.detail.slice(0, 200) } : {}),
    };
  } catch {
    // Unreadable markers are dropped rather than shown: a card nobody can open
    // is worse than the sentence the tool already wrote.
    return undefined;
  }
}

/// Splits a tool result into the text a person reads and the cards under it.
///
/// Safe on any string: text with no marker comes back untouched and with no
/// artifacts, which is what every tool that is not Remy's produces.
export function takeArtifacts(output: string): { text: string; artifacts: ConvArtifact[] } {
  if (!output.includes(OPEN)) return { text: output, artifacts: [] };
  const artifacts: ConvArtifact[] = [];
  const text = output.replace(
    new RegExp(`${OPEN}([\\s\\S]*?)${CLOSE}`, "g"),
    (_match, json: string) => {
      const artifact = parse(json);
      if (artifact && artifacts.length < MAX_ARTIFACTS) artifacts.push(artifact);
      return "";
    },
  );
  return { text: text.trim(), artifacts };
}
