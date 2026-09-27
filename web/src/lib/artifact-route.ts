import type { ConvArtifact } from "@/state/types";
import type { Route } from "./route";

/// The cards a transcript can still draw. An older transcript may carry a card
/// for something Remy no longer has, and that one is left out rather than drawn
/// as a card that opens nothing.
export function shownArtifacts(artifacts: unknown): ConvArtifact[] {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.filter((artifact): artifact is ConvArtifact =>
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
