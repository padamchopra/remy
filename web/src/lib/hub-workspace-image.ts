import { createWorkspaceImageCache } from "@/lib/workspace-image-cache";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";

const images = createWorkspaceImageCache();
const imageKey = (org: string, workspace: string, path: string) => JSON.stringify([org, workspace, path]);

/// The last decoded workspace image, if this window already loaded it.
/// A tile peeks this on first paint so a set icon does not flash the folder mark.
export function peekHubWorkspaceImage(organizationId: string, workspaceId: string, path: string) {
  return images.peek(imageKey(organizationId, workspaceId, path));
}

export function loadHubWorkspaceImage(organizationId: string, workspaceId: string, path: string) {
  return images.load(imageKey(organizationId, workspaceId, path), async () => {
    const file = await hubRequest<{ mime: string; data: string }>(`${hubThreadBase(organizationId)}/github/workspace-images?${new URLSearchParams({ workspace: workspaceId, path })}`);
    return `data:${file.mime};base64,${file.data}`;
  });
}
