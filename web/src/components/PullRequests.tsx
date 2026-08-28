import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleDot, Folder, GitPullRequest, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PullRequestView } from "@/components/PullRequestView";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type { Chat, Server, Workspace } from "@/state/types";

type PullRequestFilter = "all" | "ready" | "draft";

interface PullRequestCheck {
  name: string;
  state: "pass" | "fail" | "pending" | "skipping";
}

interface AuthoredPullRequest {
  url: string;
  number: number;
  title: string;
  repository: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  reviewDecision: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  checks: PullRequestCheck[];
  unreadComments: unknown[];
  hasUnreadActivity: boolean;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  worktreePath: string | null;
  serverId: string;
}

const PULL_REQUEST_CACHE_KEY = "remy.pull-requests.v1";
const PULL_REQUEST_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const PULL_REQUEST_POLL_MS = 60_000;

function isCachedPullRequest(value: unknown): value is AuthoredPullRequest {
  if (!value || typeof value !== "object") return false;
  const pullRequest = value as Partial<AuthoredPullRequest>;
  return typeof pullRequest.url === "string"
    && typeof pullRequest.number === "number"
    && typeof pullRequest.title === "string"
    && typeof pullRequest.repository === "string"
    && typeof pullRequest.headRefName === "string"
    && typeof pullRequest.updatedAt === "string"
    && typeof pullRequest.isDraft === "boolean"
    && typeof pullRequest.reviewDecision === "string"
    && typeof pullRequest.additions === "number"
    && typeof pullRequest.deletions === "number"
    && Array.isArray(pullRequest.checks)
    && pullRequest.checks.every((check) => check && typeof check.state === "string")
    && typeof pullRequest.hasUnreadActivity === "boolean"
    && typeof pullRequest.workspaceId === "string"
    && typeof pullRequest.workspaceName === "string"
    && typeof pullRequest.workspacePath === "string"
    && typeof pullRequest.serverId === "string";
}

function readPullRequestCache(): Map<string, AuthoredPullRequest[]> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PULL_REQUEST_CACHE_KEY) ?? "null") as {
      savedAt?: unknown;
      byServer?: unknown;
    } | null;
    if (
      !parsed
      || typeof parsed.savedAt !== "number"
      || Date.now() - parsed.savedAt > PULL_REQUEST_CACHE_MAX_AGE_MS
      || !parsed.byServer
      || typeof parsed.byServer !== "object"
    ) return new Map();
    return new Map(Object.entries(parsed.byServer as Record<string, unknown>).flatMap(([serverId, value]) =>
      Array.isArray(value) ? [[serverId, value.filter(isCachedPullRequest)]] : [],
    ));
  } catch {
    return new Map();
  }
}

const pullRequestCache = readPullRequestCache();

function cachedPullRequests(serverIds: string[]): AuthoredPullRequest[] {
  return mergePullRequests(serverIds.flatMap((serverId) => pullRequestCache.get(serverId) ?? []));
}

function hasCachedPullRequests(serverIds: string[]): boolean {
  return serverIds.some((serverId) => pullRequestCache.has(serverId));
}

function cachePullRequests(serverId: string, pullRequests: AuthoredPullRequest[]) {
  pullRequestCache.set(serverId, pullRequests);
  try {
    localStorage.setItem(PULL_REQUEST_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      byServer: Object.fromEntries(pullRequestCache),
    }));
  } catch {
    // The in-memory snapshot still keeps navigation and refreshes stable.
  }
}

function mergePullRequests(pullRequests: AuthoredPullRequest[]): AuthoredPullRequest[] {
  const byURL = new Map<string, AuthoredPullRequest>();
  for (const pullRequest of pullRequests) {
    const current = byURL.get(pullRequest.url);
    if (!current || (!current.worktreePath && pullRequest.worktreePath)) byURL.set(pullRequest.url, pullRequest);
  }
  return [...byURL.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function inside(path: string, root: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function activeThread(pullRequest: AuthoredPullRequest, chats: Chat[]): Chat | undefined {
  if (!pullRequest.worktreePath) return undefined;
  return chats
    .filter((chat) =>
      chat.serverId === pullRequest.serverId
      && (chat.state === "working" || chat.state === "needs_input")
      && inside(chat.cwd, pullRequest.worktreePath!),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

function relativeDate(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "Now";
  const minutes = Math.max(0, Math.round(elapsed / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}

function needsAttention(pullRequest: AuthoredPullRequest): boolean {
  return pullRequest.hasUnreadActivity
    || pullRequest.reviewDecision === "CHANGES_REQUESTED"
    || pullRequest.checks.some((check) => check.state === "fail");
}

export function PullRequests({
  servers,
  workspaces,
  chats,
  onOpenThread,
  onOpenWorkspace,
}: {
  servers: Server[];
  workspaces: Workspace[];
  chats: Chat[];
  onOpenThread: (id: string) => void;
  onOpenWorkspace: (id: string) => void;
}) {
  const serverIds = servers.filter((server) => !server.workspaceOnly).map((server) => server.id).sort();
  const serverKey = servers
    .filter((server) => !server.workspaceOnly)
    .map((server) => `${server.id}:${server.online ? "online" : "offline"}`)
    .sort()
    .join("\u0000");
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const [pullRequests, setPullRequests] = useState<AuthoredPullRequest[]>(() => cachedPullRequests(serverIds));
  const [filter, setFilter] = useState<PullRequestFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!hasCachedPullRequests(serverIds));
  const [refreshing, setRefreshing] = useState(false);
  const [selectedURL, setSelectedURL] = useState("");
  const requestId = useRef(0);
  const progressRequestId = useRef<number | undefined>(undefined);

  const load = useCallback(async ({ refresh = false, showProgress = false } = {}) => {
    const currentRequest = ++requestId.current;
    if (showProgress) {
      progressRequestId.current = currentRequest;
      setRefreshing(true);
    }
    const eligible = serversRef.current.filter((server) => !server.workspaceOnly);
    const available = eligible.filter((server) => server.online);
    const eligibleIds = eligible.map((server) => server.id);
    const cached = cachedPullRequests(eligibleIds);
    if (hasCachedPullRequests(eligibleIds)) {
      setPullRequests(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const batches = await Promise.all(available.map(async (server) => {
      try {
        const response = await transport.request<{ pullRequests?: Omit<AuthoredPullRequest, "serverId">[] }>(
          server.id,
          `/pull-requests${refresh ? "?refresh=1" : ""}`,
        );
        return {
          serverId: server.id,
          pullRequests: (response.pullRequests ?? []).map((pullRequest) => ({ ...pullRequest, serverId: server.id })),
        };
      } catch {
        return undefined;
      }
    }));
    if (currentRequest !== requestId.current) {
      if (progressRequestId.current === currentRequest) {
        progressRequestId.current = undefined;
        setRefreshing(false);
      }
      return;
    }
    for (const batch of batches) {
      if (batch) cachePullRequests(batch.serverId, batch.pullRequests);
    }
    setPullRequests(cachedPullRequests(eligibleIds));
    setLoading(false);
    if (progressRequestId.current === currentRequest) {
      progressRequestId.current = undefined;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), PULL_REQUEST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, serverKey]);

  const counts = useMemo(() => ({
    all: pullRequests.length,
    ready: pullRequests.filter((pullRequest) => !pullRequest.isDraft).length,
    draft: pullRequests.filter((pullRequest) => pullRequest.isDraft).length,
  }), [pullRequests]);
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return pullRequests.filter((pullRequest) => {
      const matchesFilter = filter === "all" || (filter === "draft" ? pullRequest.isDraft : !pullRequest.isDraft);
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return [pullRequest.title, pullRequest.repository, pullRequest.headRefName, String(pullRequest.number)]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [filter, pullRequests, query]);
  const selected = visible.find((pullRequest) => pullRequest.url === selectedURL);
  const sections = useMemo(() => {
    const grouped = new Map<string, {
      key: string;
      label: string;
      workspace?: Workspace;
      server?: Server;
      pullRequests: AuthoredPullRequest[];
    }>();
    for (const pullRequest of visible) {
      const key = `${pullRequest.serverId}:${pullRequest.workspaceId}`;
      let section = grouped.get(key);
      if (!section) {
        const workspace = workspaces.find((entry) =>
          entry.serverId === pullRequest.serverId && entry.id === pullRequest.workspaceId);
        section = {
          key,
          label: workspace?.name ?? pullRequest.workspaceName,
          workspace,
          server: servers.find((entry) => entry.id === pullRequest.serverId),
          pullRequests: [],
        };
        grouped.set(key, section);
      }
      section.pullRequests.push(pullRequest);
    }
    return [...grouped.values()];
  }, [servers, visible, workspaces]);
  const selectedWorkspace = selected && workspaces.find((entry) =>
    entry.serverId === selected.serverId && entry.id === selected.workspaceId);
  const selectedServer = selected && servers.find((entry) => entry.id === selected.serverId);
  const selectedThread = selected && activeThread(selected, chats);

  return (
    <main className="flex min-w-0 flex-1">
      <section className="flex min-h-0 w-[38%] min-w-72 max-w-[27rem] shrink-0 flex-col border-r border-border">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <ToggleGroup
            type="single"
            size="sm"
            value={filter}
            onValueChange={(value) => value && setFilter(value as PullRequestFilter)}
            aria-label="Filter pull requests"
            className="gap-0.5"
          >
            <ToggleGroupItem value="all" className="px-2.5">All <span className="text-muted-foreground">{counts.all}</span></ToggleGroupItem>
            <ToggleGroupItem value="ready" className="px-2.5">Ready <span className="text-muted-foreground">{counts.ready}</span></ToggleGroupItem>
            <ToggleGroupItem value="draft" className="px-2.5">Drafts <span className="text-muted-foreground">{counts.draft}</span></ToggleGroupItem>
          </ToggleGroup>
          <Button variant="ghost" size="icon-sm" className="ml-auto" disabled={refreshing} onClick={() => void load({ refresh: true, showProgress: true })} aria-label="Refresh pull requests">
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          </Button>
        </div>

        <div className="shrink-0 p-3">
          <InputGroup>
            <InputGroupAddon><Search /></InputGroupAddon>
            <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pull requests" aria-label="Search pull requests" />
          </InputGroup>
        </div>

        {loading ? (
          <PullRequestListLoading />
        ) : visible.length === 0 ? (
          <Empty className="min-h-0 flex-1 px-5">
            <EmptyHeader>
              <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
              <EmptyTitle>{pullRequests.length === 0 ? "No pull requests" : "No matching pull requests"}</EmptyTitle>
              <EmptyDescription>
                {pullRequests.length === 0 ? "Open one from a GitHub workspace you added to Remy." : "Try another search or filter."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="pb-3">
              {sections.map((section) => (
                <section key={section.key} aria-label={section.label}>
                  <h2 className="flex items-center gap-2 px-4 pb-1 pt-3 text-[11px] font-medium text-muted-foreground">
                    {section.workspace ? (
                      <WorkspaceMark home={false} workspace={section.workspace} server={section.server} size="sm" />
                    ) : (
                      <Folder className="size-4 shrink-0" />
                    )}
                    <span className="truncate">{section.label}</span>
                  </h2>
                  <ItemGroup className="gap-0 px-2">
                    {section.pullRequests.map((pullRequest) => (
                      <PullRequestListItem key={pullRequest.url} pullRequest={pullRequest} selected={selected?.url === pullRequest.url} onSelect={() => setSelectedURL(pullRequest.url)} />
                    ))}
                  </ItemGroup>
                </section>
              ))}
            </div>
          </ScrollArea>
        )}
      </section>

      <section className="min-w-0 flex-1">
        {selected ? (
          <PullRequestView
            key={selected.url}
            serverId={selected.serverId}
            repository={selected.repository}
            number={selected.number}
            actions={(
              <>
                {selectedWorkspace && (
                  <Button variant="ghost" size="sm" data-link className="max-w-48" onClick={() => onOpenWorkspace(selectedWorkspace.id)}>
                    <WorkspaceMark home={false} workspace={selectedWorkspace} server={selectedServer} size="sm" />
                    <span className="truncate">{selected.workspaceName}</span>
                  </Button>
                )}
                {selectedThread && (
                  <Button variant="secondary" size="sm" data-link onClick={() => onOpenThread(selectedThread.id)}>
                    <CircleDot className="text-success-foreground" />
                    Open thread
                  </Button>
                )}
              </>
            )}
          />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
              <EmptyTitle>Select a pull request</EmptyTitle>
              <EmptyDescription>Choose one to review its summary and code.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </main>
  );
}

function PullRequestListItem({ pullRequest, selected, onSelect }: { pullRequest: AuthoredPullRequest; selected: boolean; onSelect: () => void }) {
  return (
    <Item
      asChild
      size="sm"
      className={cn(
        "grid! grid-cols-[1rem_minmax(0,1fr)_5.5rem] items-start gap-x-3 gap-y-0 rounded-md px-2 py-2.5 text-left hover:bg-accent/70",
        selected && "bg-accent",
      )}
    >
      <button type="button" data-link aria-pressed={selected} onClick={onSelect}>
        <ItemMedia className="relative col-start-1 row-start-1 self-start text-muted-foreground">
          <GitPullRequest className="size-4" />
          {needsAttention(pullRequest) && (
            <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-2 border-background bg-destructive" />
          )}
        </ItemMedia>
        <ItemContent className="col-start-2 row-start-1 min-w-0 gap-1">
          <ItemTitle className="w-full min-w-0 font-normal">
            <span className="truncate">{pullRequest.title}</span>
            {needsAttention(pullRequest) && <span className="sr-only">Needs attention</span>}
          </ItemTitle>
          <ItemDescription className="block min-w-0 truncate text-left text-[11px] text-nowrap">
            {pullRequest.repository} · {pullRequest.headRefName}
          </ItemDescription>
        </ItemContent>
        <span className="col-start-3 row-start-1 grid self-stretch grid-rows-2 justify-items-end gap-1 text-[11px] tabular-nums">
          <span className="leading-snug text-muted-foreground">{relativeDate(pullRequest.updatedAt)}</span>
          <span className="font-mono leading-normal text-nowrap">
            <span className="text-success-foreground">+{pullRequest.additions}</span>{" "}
            <span className="text-destructive">−{pullRequest.deletions}</span>
          </span>
        </span>
      </button>
    </Item>
  );
}

function PullRequestListLoading() {
  return (
    <div className="flex flex-col gap-4 px-4 py-3" aria-label="Loading pull requests">
      {["w-4/5", "w-3/5", "w-2/3", "w-5/6"].map((width, index) => (
        <span key={index} className="flex items-start gap-3">
          <span className="shimmer mt-1 size-4 rounded" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={cn("shimmer h-3 rounded", width)} />
            <span className="shimmer h-2.5 w-full rounded" />
          </span>
        </span>
      ))}
    </div>
  );
}
