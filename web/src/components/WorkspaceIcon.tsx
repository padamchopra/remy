import { useEffect, useState } from "react";
import { Folder } from "lucide-react";
import { isProjectIconFile, projectIcon } from "@/lib/projects";
import { deviceIcon } from "@/lib/devices";
import { tintOf } from "@/lib/tints";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Server, Workspace } from "@/state/types";

const cache = new Map<string, string>();

export function WorkspaceIcon({
  workspaceId,
  icon,
  className,
  fileClassName,
}: {
  workspaceId: string;
  icon?: string | null;
  className?: string;
  fileClassName?: string;
}) {
  if (isProjectIconFile(icon)) {
    return (
      <WorkspaceFileIcon
        workspaceId={workspaceId}
        path={icon}
        className={fileClassName ?? className}
        fallbackClassName={className}
      />
    );
  }
  const Icon = projectIcon(icon);
  return <Icon className={cn("size-4", className)} />;
}

export function WorkspaceFileIcon({
  workspaceId,
  path,
  className,
  fallbackClassName,
}: {
  workspaceId: string;
  path: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const workspaceFile = useStore((s) => s.workspaceFile);
  const key = `${workspaceId}:${path}`;
  const [src, setSrc] = useState(cache.get(key));

  useEffect(() => {
    const cached = cache.get(key);
    setSrc(cached);
    if (cached) return;
    let cancelled = false;
    void workspaceFile(workspaceId, path).then((file) => {
      if (cancelled || !file) return;
      const next = `data:${file.mime};base64,${file.data}`;
      cache.set(key, next);
      setSrc(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key, path, workspaceFile, workspaceId]);

  if (!src) return <Folder className={cn("size-4", fallbackClassName ?? className)} />;
  return <img src={src} alt="" className={cn("block size-4 object-contain object-center", className)} />;
}

/// A workspace as it appears inline: its icon in its tint, or the machine's
/// own icon for a chat that is not in a workspace at all.
export function WorkspaceMark({
  home,
  workspace,
  server,
  size,
}: {
  home: boolean;
  workspace?: Workspace;
  server?: Server;
  size: "sm" | "lg";
}) {
  const box = size === "lg" ? "size-[1em]" : "size-4";
  const glyph = size === "lg" ? "size-[0.65em]" : "size-3";
  if (home || !workspace) {
    const Icon = deviceIcon(server?.icon);
    if (size === "lg") {
      return <Icon className="block shrink-0 size-[1em]" />;
    }
    // Same slot as a project well, so names in a list share one x.
    return (
      <span className={cn("inline-flex shrink-0 items-center justify-center", box)}>
        <Icon className={cn("block", glyph)} />
      </span>
    );
  }
  const colors = tintOf(workspace.tint);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md leading-none",
        box,
        colors.well,
        colors.fg,
      )}
    >
      <WorkspaceIcon
        workspaceId={workspace.id}
        icon={workspace.icon}
        className={glyph}
        fileClassName="size-full"
      />
    </span>
  );
}
