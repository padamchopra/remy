import { useMemo } from "react";
import { Check, Folder, Layers, ListFilter } from "lucide-react";
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WorkspaceIcon, WorkspaceMark } from "@/components/WorkspaceIcon";
import { localWorkspace } from "@/lib/projects";
import { tintOf } from "@/lib/tints";
import { cn } from "@/lib/utils";
import type { Project, Workspace } from "@/state/types";

/// Which workspaces you are looking at.
///
/// Shared by both halves of Tasks, which is why it lives here rather than in
/// either of them: the filter is the scope in the URL, so switching tabs keeps
/// what you narrowed to.

/// The key prefixes a scope segment names. Empty means every project.
export function chosenPrefixes(scope?: string): Set<string> {
  return new Set((scope ?? "").split(",").map((part) => part.trim()).filter(Boolean));
}

/// The projects a scope leaves in view.
export function scopedProjects(projects: Project[], chosen: Set<string>): Project[] {
  return chosen.size === 0 ? projects : projects.filter((project) => chosen.has(project.keyPrefix));
}

/// Whose work is in view, as faces. Says which workspaces a pane is showing
/// without spending a breadcrumb on it.
export function WorkspaceFaces({ projects, workspaces }: { projects: Project[]; workspaces: Workspace[] }) {
  if (projects.length === 0) return null;
  const shown = projects.slice(0, 3);
  const rest = projects.length - shown.length;

  return (
    <AvatarGroup data-size="sm">
      {shown.map((project) => {
        const workspace = localWorkspace(project, workspaces);
        const colors = tintOf(workspace?.tint);
        return (
          <Tooltip key={project.id}>
            <TooltipTrigger asChild>
              <Avatar className="size-6" aria-label={project.name}>
                <AvatarFallback className={cn(colors.well, colors.fg)}>
                  {workspace ? (
                    <WorkspaceIcon workspaceId={workspace.id} icon={workspace.icon} className="size-3" fileClassName="size-full object-cover" />
                  ) : (
                    <span className="text-[10px] font-medium">{project.keyPrefix.slice(0, 1)}</span>
                  )}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>{project.name}</TooltipContent>
          </Tooltip>
        );
      })}
      {rest > 0 && <AvatarGroupCount className="size-6 text-[11px]">+{rest}</AvatarGroupCount>}
    </AvatarGroup>
  );
}

/// Every workspace by default; ticking some narrows it, and the URL carries
/// what you ticked.
export function ProjectFilter({
  projects,
  workspaces,
  chosen,
  onScope,
}: {
  projects: Project[];
  workspaces: Workspace[];
  chosen: Set<string>;
  onScope: (scope?: string) => void;
}) {
  const toggle = (prefix: string) => {
    const next = new Set(chosen);
    if (next.has(prefix)) next.delete(prefix);
    else next.add(prefix);
    // Everything ticked is the same view as nothing ticked, and the shorter URL
    // is the honest one.
    onScope(next.size === 0 || next.size === projects.length ? undefined : [...next].join(","));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <ListFilter />
          {chosen.size === 0 ? "All workspaces" : `${chosen.size} workspace${chosen.size === 1 ? "" : "s"}`}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => onScope(undefined)}>
          {/* An icon slot of its own, so this name starts where the others do. */}
          <span className="flex size-5 items-center justify-center rounded bg-muted text-muted-foreground">
            <Layers className="size-3" />
          </span>
          <span className="truncate">All workspaces</span>
          {chosen.size === 0 && <Check className="ml-auto" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {projects.map((project) => {
          const workspace = localWorkspace(project, workspaces);
          return (
            <DropdownMenuItem
              key={project.id}
              // Kept open so several can be ticked in one go.
              onSelect={(event) => {
                event.preventDefault();
                toggle(project.keyPrefix);
              }}
            >
              <span className="flex size-5 items-center justify-center">
                {workspace ? (
                  <WorkspaceMark home={false} workspace={workspace} size="sm" />
                ) : (
                  <span className="flex size-4 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Folder className="size-3" />
                  </span>
                )}
              </span>
              <span className="truncate">{project.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{project.keyPrefix}</span>
              {chosen.has(project.keyPrefix) && <Check className="ml-auto" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/// The header controls both tabs share: who is in view, and the filter.
export function ProjectScope({
  projects,
  shown,
  workspaces,
  scope,
  onScope,
}: {
  projects: Project[];
  shown: Project[];
  workspaces: Workspace[];
  scope?: string;
  onScope: (scope?: string) => void;
}) {
  const chosen = useMemo(() => chosenPrefixes(scope), [scope]);
  return (
    <>
      <WorkspaceFaces projects={shown} workspaces={workspaces} />
      <ProjectFilter projects={projects} workspaces={workspaces} chosen={chosen} onScope={onScope} />
    </>
  );
}
