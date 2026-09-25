import { WorkspaceMarkFrame } from "./WorkspaceMarkFrame";
import { useEffect, useState } from "react";
import { isProjectIconFile, projectIcon } from "@/lib/projects";
import { deviceIcon } from "@/lib/devices";
import { loadHubWorkspaceImage, peekHubWorkspaceImage } from "@/lib/hub-workspace-image";
import { createWorkspaceImageCache } from "@/lib/workspace-image-cache";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Server } from "@/state/types";

const localImages = createWorkspaceImageCache();

export type WorkspaceIconSource = {
  id: string;
  icon?: string | null;
  tint?: string | null;
};

export function WorkspaceIcon({
  workspaceId,
  icon,
  className,
  fileClassName,
  organizationId,
}: {
  workspaceId: string;
  icon?: string | null;
  className?: string;
  fileClassName?: string;
  organizationId?: string;
}) {
  if (isProjectIconFile(icon)) {
    return (
      <WorkspaceFileIcon
        workspaceId={workspaceId}
        path={icon}
        organizationId={organizationId}
        className={fileClassName ?? className}
      />
    );
  }
  const Icon = projectIcon(icon);
  return <Icon data-slot="workspace-icon" className={cn("size-4", className)} />;
}

export function WorkspaceFileIcon({
  workspaceId,
  path,
  className,
  organizationId,
}: {
  workspaceId: string;
  path: string;
  className?: string;
  organizationId?: string;
}) {
  const workspaceFile = useStore((s) => s.workspaceFile);
  const key = organizationId ? JSON.stringify([organizationId, workspaceId, path]) : `${workspaceId}:${path}`;
  const peeked = organizationId
    ? peekHubWorkspaceImage(organizationId, workspaceId, path)
    : localImages.peek(key);
  const [loaded, setLoaded] = useState<{ key: string; src: string }>();
  const src = peeked ?? (loaded?.key === key ? loaded.src : undefined);

  useEffect(() => {
    let cancelled = false;
    const load = organizationId
      ? loadHubWorkspaceImage(organizationId, workspaceId, path)
      : localImages.load(key, async () => {
          const file = await workspaceFile(workspaceId, path);
          if (!file) throw new Error("Workspace image is missing.");
          return `data:${file.mime};base64,${file.data}`;
        });
    void load
      .then((next) => {
        if (cancelled || !next) return;
        setLoaded({ key, src: next });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, organizationId, path, workspaceFile, workspaceId]);

  if (src) {
    return <img src={src} alt="" data-slot="workspace-icon" className={cn("block size-4 object-contain object-center", className)} />;
  }
  // A file icon is already set; the folder glyph is the empty workspace mark.
  return <span data-slot="workspace-icon" aria-hidden className={cn("block size-4", className)} />;
}

/// A workspace as it appears inline: its icon in its tint, or the machine's
/// own icon for a chat that is not in a workspace at all.
export function WorkspaceMark({
  home,
  workspace,
  server,
  size,
  organizationId,
}: {
  home: boolean;
  workspace?: WorkspaceIconSource;
  server?: Server;
  size: "sm" | "md" | "lg";
  organizationId?: string;
}) {
  const glyph = size === "lg" ? "size-[0.65em]" : size === "md" ? "size-4" : "size-3";
  if (home || !workspace) {
    const Icon = deviceIcon(server?.icon);
    if (size === "lg") {
      return <Icon className="block shrink-0 size-[1em]" />;
    }
    const box = size === "md" ? "size-10" : "size-4";
    // Same slot as a project well, so names in a list share one x.
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center", box)}>
        <Icon className={cn("block", glyph)} />
      </span>
    );
  }
  return (
    <WorkspaceMarkFrame size={size} tint={workspace.tint}>
      <WorkspaceIcon
        workspaceId={workspace.id}
        icon={workspace.icon}
        organizationId={organizationId}
        className={glyph}
        fileClassName="size-full object-cover"
      />
    </WorkspaceMarkFrame>
  );
}
