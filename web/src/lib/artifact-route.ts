import type { ConvArtifact } from "@/state/types";
import type { Route } from "./route";

export function organizationArtifactRoute(
  artifact: ConvArtifact,
): Route | undefined {
  const { organizationId, id, computerId } = artifact;
  if (!organizationId || !id) return;
  if (artifact.kind === "ticket")
    return { name: "ticket", key: id, organizationId };
  if (artifact.kind === "thread" && computerId)
    return { name: "threads", threadId: id, computerId, organizationId };
  if (artifact.kind === "workspace")
    return { name: "workspaces", workspaceId: id, organizationId };
  if (artifact.kind === "routine") return { name: "inbox", organizationId };
}
