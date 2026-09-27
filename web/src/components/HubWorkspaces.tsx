import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, Folder, Search, SquarePen, User } from "lucide-react";
import type { ComputerSummary, HubThread, Organization } from "@remy/contract";
import { watchHubResource } from "@/lib/hub-computers";
import { hubThreadBase } from "@/lib/hub-threads";
import type { HubWorkspace } from "@/lib/hub-organization";
import {
  cacheHubWorkspaces,
  cachedHubWorkspaces,
  hasCachedHubWorkspaces,
  hasCachedHubWorkspacesFor,
} from "@/lib/hub-workspace-cache";
import { agoLabel } from "@/lib/elapsed";
import {
  compareWorkspaces,
  hubThreadActivity,
  hubThreadWorkspace,
  workspaceMatches,
  workspaceOriginLabel,
} from "@/lib/workspace-list";
import { cn } from "@/lib/utils";
import { HubAddWorkspace } from "./HubAddWorkspace";
import { WorkspaceMark } from "./WorkspaceIcon";
import { WorkspaceListSkeleton } from "./WorkspaceListSkeleton";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { Item, ItemGroup } from "./ui/item";
import { Kbd } from "./ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip-base";

type Lists = { key: string; workspaces: Map<string, HubWorkspace[]>; computers: Map<string, ComputerSummary[]>; live: Set<string> };

function listsFromCache(key: string): Lists {
  const workspaces = new Map<string, HubWorkspace[]>();
  for (const id of key.split(",").filter(Boolean)) {
    if (hasCachedHubWorkspaces(id)) workspaces.set(id, cachedHubWorkspaces(id) as HubWorkspace[]);
  }
  return { key, workspaces, computers: new Map(), live: new Set() };
}

type Row = {
  key: string;
  organizationId: string;
  workspace: HubWorkspace;
  owner: string;
  personal: boolean;
  lastThreadAt?: number;
};

/// Every workspace the account view can reach, one dense row each, newest
/// thread first. The All view names each row's owner; a single owner does not.
export default function HubWorkspaces({ organizations, filter, threads, open, adding, onAddingChange, onOpenWorkspace, onNewThread, onAdded }: {
  organizations: Organization[];
  filter: string;
  threads: HubThread[];
  /// Whether the list is on screen, so `/` only reaches the visible search.
  open: boolean;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  onOpenWorkspace: (organizationId: string, workspaceId: string) => void;
  onNewThread: (organizationId: string, workspaceId: string) => void;
  onAdded: (organizationId: string) => void;
}) {
  const visible = organizations.filter((o) => filter === "all" || o.id === filter);
  const ids = visible.map((o) => o.id).join(",");
  const [lists, setLists] = useState<Lists>(() => listsFromCache(ids));
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const next = listsFromCache(ids);
    setError("");
    setLists(next);
    const emit = () => setLists({ ...next, workspaces: new Map(next.workspaces), computers: new Map(next.computers), live: new Set(next.live) });
    const stops = ids.split(",").filter(Boolean).flatMap((id) => [
      watchHubResource<{ workspaces: HubWorkspace[] }>(`${hubThreadBase(id)}/workspaces`, (value) => {
        if (value) {
          cacheHubWorkspaces(id, value.workspaces);
          next.workspaces.set(id, value.workspaces);
          next.live.add(id);
        }
        emit();
      }, setError, `${hubThreadBase(id)}/live`),
      // Only to tell which workspace a thread on a connected computer ran in.
      watchHubResource<{ computers: ComputerSummary[] }>(`${hubThreadBase(id)}/computers`, (value) => {
        if (value) next.computers.set(id, value.computers);
        emit();
      }, () => {}, `${hubThreadBase(id)}/computers/live`),
    ]);
    return () => stops.forEach((stop) => stop());
  }, [ids]);

  useEffect(() => {
    if (!open) return;
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog]")) return;
      if (!search.current) return;
      event.preventDefault();
      search.current.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [open]);

  const current = lists.key === ids ? lists : listsFromCache(ids);
  const loaded = visible.every((owner) => current.live.has(owner.id));
  const cached = hasCachedHubWorkspacesFor(visible.map((owner) => owner.id));
  const waiting = !loaded && !cached && !error;
  const canAdd = visible.some((o) => o.role !== "member");
  const showOwner = filter === "all";

  const rows = useMemo(() => {
    const byKey = new Map<string, Row>();
    for (const owner of visible) {
      for (const workspace of current.workspaces.get(owner.id) ?? []) {
        byKey.set(`${owner.id}:${workspace.id}`, {
          key: `${owner.id}:${workspace.id}`,
          organizationId: owner.id,
          workspace,
          owner: owner.personal ? "Personal" : owner.name,
          personal: owner.personal === true,
        });
      }
    }
    for (const thread of threads) {
      const owner = thread.access.organizationId || (filter === "all" ? "" : filter);
      const workspace = hubThreadWorkspace(thread, current.computers.get(owner), current.workspaces.get(owner));
      const row = workspace && byKey.get(`${owner}:${workspace.id}`);
      if (!row) continue;
      const at = hubThreadActivity(thread);
      if (row.lastThreadAt === undefined || at > row.lastThreadAt) row.lastThreadAt = at;
    }
    return [...byKey.values()].sort((left, right) =>
      compareWorkspaces({ name: left.workspace.name, lastThreadAt: left.lastThreadAt }, { name: right.workspace.name, lastThreadAt: right.lastThreadAt }));
    // `visible` is derived from `ids` and `organizations`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, threads, organizations, ids, filter]);
  const shown = rows.filter((row) => workspaceMatches(query, { name: row.workspace.name, origin: row.workspace.origin, owner: showOwner ? row.owner : "" }));
  const now = Date.now();
  const onlyOwner = visible.length === 1 ? visible[0] : undefined;

  return (
    <TooltipProvider>
      <section className="mx-auto flex min-h-full w-full max-w-[1040px] min-w-0 flex-col gap-4 px-4 py-7 sm:px-10" aria-label="Workspaces">
        {error && <p role="alert" className="text-sm text-error-foreground">{error}</p>}
        {waiting ? <WorkspaceListSkeleton /> : rows.length === 0 ? (
          canAdd ? (
            <WorkspaceEmpty
              icon={<Folder />}
              title="Add your first workspace"
              description="Pick a repository and start threads on it from any computer."
            >
              <Button className="h-8 rounded-[9px] px-3.5 text-xs font-semibold" onClick={() => onAddingChange(true)}>Add workspace</Button>
            </WorkspaceEmpty>
          ) : (
            <WorkspaceEmpty
              icon={<Folder />}
              title="No workspaces yet"
              description={`Ask an admin of ${onlyOwner && !onlyOwner.personal ? onlyOwner.name : "your organization"} to add a repository.`}
            />
          )
        ) : (
          <>
            <div className="flex items-center gap-2">
              <InputGroup className="h-8 max-w-[360px] flex-1 rounded-md border-input bg-card shadow-none dark:bg-card">
                <InputGroupAddon className="pl-2.5 [&>svg:not([class*='size-'])]:size-3.5">
                  <Search strokeWidth={1.8} />
                </InputGroupAddon>
                <InputGroupInput
                  ref={search}
                  type="search"
                  aria-label="Search workspaces"
                  placeholder="Search workspaces"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    if (query) setQuery("");
                    else event.currentTarget.blur();
                  }}
                  className="h-full pl-2 text-[13px] leading-[18px] md:text-[13px] [&::-webkit-search-cancel-button]:hidden"
                />
                <InputGroupAddon align="inline-end" className="pr-2.5 [@media(hover:none)]:hidden">
                  <Kbd className="h-auto min-w-0 rounded-[4px] border border-input bg-transparent px-[5px] py-px font-mono text-[11px] leading-[14px] font-normal">/</Kbd>
                </InputGroupAddon>
              </InputGroup>
              <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                {shown.length === rows.length ? rows.length : `${shown.length} of ${rows.length}`} {rows.length === 1 ? "workspace" : "workspaces"}
              </span>
            </div>
            {shown.length === 0 ? (
              <WorkspaceEmpty
                icon={<Search />}
                title={`No workspaces match “${query.trim()}”`}
                description="Search matches a workspace's name, its repository and its owner."
              >
                <Button variant="outline" className="h-8 rounded-[9px] px-3.5 text-xs font-medium shadow-none" onClick={() => { setQuery(""); search.current?.focus(); }}>Clear search</Button>
              </WorkspaceEmpty>
            ) : (
              <ItemGroup className="overflow-clip rounded-[10px] border border-border">
                {shown.map((row) => (
                  <WorkspaceRow
                    key={row.key}
                    row={row}
                    showOwner={showOwner}
                    time={row.lastThreadAt === undefined ? undefined : agoLabel(row.lastThreadAt, now)}
                    onOpen={() => onOpenWorkspace(row.organizationId, row.workspace.id)}
                    onNewThread={() => onNewThread(row.organizationId, row.workspace.id)}
                  />
                ))}
              </ItemGroup>
            )}
          </>
        )}
        <HubAddWorkspace organizationId={filter === "all" ? organizations.find((o) => o.personal)?.id ?? organizations[0]?.id ?? "" : filter} organizations={organizations} open={adding} onOpenChange={onAddingChange} onAdded={onAdded} />
      </section>
    </TooltipProvider>
  );
}

function WorkspaceRow({ row, showOwner, time, onOpen, onNewThread }: {
  row: Row;
  showOwner: boolean;
  time?: string;
  onOpen: () => void;
  onNewThread: () => void;
}) {
  const { workspace } = row;
  const OwnerIcon = row.personal ? User : Building2;
  return (
    <Item
      role="listitem"
      className="relative h-[52px] flex-nowrap gap-3 rounded-none border-0 border-b border-border px-3.5 py-0 transition-colors last:border-b-0 hover:bg-muted has-[[data-row-open]:focus-visible]:bg-muted"
    >
      <button
        type="button"
        data-link
        data-row-open
        aria-label={`Open ${workspace.name}`}
        className="absolute inset-0 rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
      />
      <span className="pointer-events-none flex shrink-0">
        <WorkspaceMark home={false} workspace={workspace} size="row" organizationId={row.organizationId} />
      </span>
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] leading-[18px] font-medium text-foreground">{workspace.name}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">{workspaceOriginLabel(workspace.origin)}</span>
      </div>
      {showOwner && (
        <span className="pointer-events-none hidden w-[140px] shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <OwnerIcon className="size-[13px] shrink-0" strokeWidth={1.8} aria-hidden />
          <span className="truncate">{row.owner}</span>
        </span>
      )}
      <span className="pointer-events-none w-12 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {time && <><span className="sr-only">Last thread </span><span>{time}</span></>}
      </span>
      <span className="relative flex size-7 shrink-0 items-center justify-center">
        <Tooltip>
          <TooltipTrigger
            render={(
              <Button
                variant="ghost"
                size="icon"
                aria-label="New thread"
                className="size-7 rounded-[7px] text-foreground transition-opacity hover:bg-input focus-visible:opacity-100 dark:hover:bg-input [@media(hover:hover)]:opacity-0 group-hover/item:!opacity-100 group-focus-within/item:!opacity-100 [&_svg:not([class*='size-'])]:size-3.5"
                onClick={onNewThread}
              >
                <SquarePen strokeWidth={1.8} />
              </Button>
            )}
          />
          <TooltipContent sideOffset={5} className="rounded-[6px] px-2 py-[5px] font-medium">New thread</TooltipContent>
        </Tooltip>
      </span>
    </Item>
  );
}

function WorkspaceEmpty({ icon, title, description, children }: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <Empty className="gap-3.5 p-0 md:p-0">
      <EmptyMedia className={cn("mb-0 size-11 rounded-[12px] border border-input bg-card text-muted-foreground", "[&_svg:not([class*='size-'])]:size-5")}>
        {icon}
      </EmptyMedia>
      <EmptyHeader className="max-w-[380px] gap-1.5">
        <EmptyTitle className="text-[15px] leading-[21px] font-semibold tracking-normal">{title}</EmptyTitle>
        <EmptyDescription className="text-xs leading-[19px]">{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent className="w-auto">{children}</EmptyContent>}
    </Empty>
  );
}
