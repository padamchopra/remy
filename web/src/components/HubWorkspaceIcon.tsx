import { createWorkspaceImageCache } from "@/lib/workspace-image-cache";
import { useEffect, useState } from "react";
import { projectIcon, isProjectIconFile } from "@/lib/projects";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { cn } from "@/lib/utils";

const images = createWorkspaceImageCache();
const imageKey = (org: string, workspace: string, path: string) => JSON.stringify([org, workspace, path]);

export function loadHubWorkspaceImage(organizationId: string, workspaceId: string, path: string) {
  return images.load(imageKey(organizationId, workspaceId, path), async () => {
  const file = await hubRequest<{ mime: string; data: string }>(`${hubThreadBase(organizationId)}/github/workspace-images?${new URLSearchParams({ workspace: workspaceId, path })}`);
  return `data:${file.mime};base64,${file.data}`;
  });
}

export function HubWorkspaceIcon({ organizationId, workspaceId, icon, className }: { organizationId: string; workspaceId: string; icon?: string; className?: string }) {
  const key = imageKey(organizationId, workspaceId, icon ?? "");
  const [loaded, setLoaded] = useState<{ key: string; src: string }>();
  const src = images.peek(key) ?? (loaded?.key === key ? loaded.src : undefined);
  useEffect(() => {
    if (!isProjectIconFile(icon)) return;
    let active = true;
    void loadHubWorkspaceImage(organizationId, workspaceId, icon).then(value => { if (active) setLoaded({ key, src: value }); }).catch(() => {});
    return () => { active = false; };
  }, [organizationId, workspaceId, icon, key]);
  const Icon = projectIcon(icon);
  if (isProjectIconFile(icon) && !src) return <span role="status" aria-label="Loading workspace image" className={cn("size-6 rounded bg-muted", className)} />;
  return src ? <img src={src} alt="" className={cn("size-6 object-contain", className)} /> : <Icon className={cn("size-6", className)} />;
}
