import type { ConvArtifact } from "@/state/types";
import type { Route } from "./route";

/// A card the feed draws itself. A review's findings and proposed rules are
/// drawn by the review agent's pane, not as feed cards.
export type ShownArtifact = ConvArtifact & { kind: "thread" | "workspace" };

/// The cards a transcript can still draw. An older transcript may carry a card
/// for something Remy no longer has, and that one is left out rather than drawn
/// as a card that opens nothing.
export function shownArtifacts(artifacts: unknown): ShownArtifact[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.filter((artifact): artifact is ShownArtifact =>
    Boolean(artifact) && (artifact.kind === "thread" || artifact.kind === "workspace"));
}

export function organizationArtifactRoute(
  artifact: ConvArtifact,
): Route | undefined {
  const { organizationId, id } = artifact;
  if (!organizationId || !id) return;
  if (artifact.kind === "thread")
    return { name: "threads", threadId: id, organizationId };
  if (artifact.kind === "workspace")
    return { name: "workspaces", workspaceId: id, organizationId };
}
