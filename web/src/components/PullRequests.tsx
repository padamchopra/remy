import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Check, ChevronDown, CircleDot, GitPullRequest, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PullRequestView } from "@/components/PullRequestView";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { workspaceGroups, type WorkspaceGroup } from "@/lib/projects";
import { orderPullRequests } from "@/lib/pull-request-order";
import { relativeDate } from "@/lib/relative-date";
import { hubRequest, HubRequestError, hubThreadBase } from "@/lib/hub-threads";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Chat, PullRequestStack, Server, Workspace } from "@/state/types";

type PullRequestFilter = "needs" | "yours" | "review" | "all";

const COLLAPSED_KEY = "remy.pull-requests.sections";

interface PullRequestCheck {
  name: string;
  state: "pass" | "fail" | "pending" | "skipping";
}

interface AuthoredPullRequest {
  stack?: PullRequestStack | null;
  url: string;
  number: number;
  title: string;
  repository: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  reviewDecision: string;
  authorLogin?: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  body?: string;
  changedFiles?: number;
  mergeable?: string;
  mergeStateStatus?: string;
  state?: string;
  checks: PullRequestCheck[];
  unreadComments: unknown[];
  hasUnreadActivity: boolean;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  worktreePath: string | null;
  serverId: string;
  sourceServerIds?: string[];
}

const PULL_REQUEST_CACHE_KEY = "remy.pull-requests.v1";
const PULL_REQUEST_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
/// What is kept for the next launch, as opposed to what this window shows. A
/// cache with no size bound is one that eventually cannot be written at all, so
/// each device stores the pull requests somebody would actually scroll to and
/// the least recently answered device is the first to be dropped. Neither bound
/// touches the list on screen: that is whatever the device answered.
const PULL_REQUEST_CACHE_PER_DEVICE = 50;
const PULL_REQUEST_CACHE_DEVICES = 12;
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
    && associatedWithWorkspace(pullRequest)
    && typeof pullRequest.workspaceName === "string"
    && typeof pullRequest.workspacePath === "string"
    && typeof pullRequest.serverId === "string";
}

function associatedWithWorkspace(pullRequest: { workspaceId?: string }) {
  // Hosted rows without a workspace used to take owner/repo as workspaceId.
  const workspaceId = pullRequest.workspaceId ?? "";
  return workspaceId.length > 0 && !workspaceId.includes("/");
}

function boundedPullRequests(pullRequests: AuthoredPullRequest[]): AuthoredPullRequest[] {
  return [...pullRequests]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, PULL_REQUEST_CACHE_PER_DEVICE);
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
    return new Map(Object.entries(parsed.byServer as Record<string, unknown>)
      .flatMap(([serverId, value]): [string, AuthoredPullRequest[]][] =>
        Array.isArray(value) ? [[serverId, boundedPullRequests(value.filter(isCachedPullRequest))]] : [])
      .slice(-PULL_REQUEST_CACHE_DEVICES));
  } catch {
    return new Map();
  }
}

const pullRequestCache = readPullRequestCache();

function cachedPullRequests(serverIds: string[]): AuthoredPullRequest[] {
  return mergePullRequests(serverIds.flatMap((serverId) =>
    (pullRequestCache.get(serverId) ?? []).filter(associatedWithWorkspace)));
}

function hasCachedPullRequests(serverIds: string[]): boolean {
  return serverIds.some((serverId) => pullRequestCache.has(serverId));
}

function cachePullRequests(serverId: string, pullRequests: AuthoredPullRequest[]) {
  // Re-inserted rather than replaced in place, so the map's own order is which
  // device answered least recently — which is the order the stored copy sheds.
  pullRequestCache.delete(serverId);
  pullRequestCache.set(serverId, pullRequests.filter(associatedWithWorkspace));
  try {
    localStorage.setItem(PULL_REQUEST_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      byServer: Object.fromEntries([...pullRequestCache]
        .slice(-PULL_REQUEST_CACHE_DEVICES)
        .map(([device, rows]) => [device, boundedPullRequests(rows)])),
    }));
  } catch {
    // The in-memory snapshot still keeps navigation and refreshes stable.
  }
}

function mergePullRequests(pullRequests: AuthoredPullRequest[]): AuthoredPullRequest[] {
  const byURL = new Map<string, AuthoredPullRequest>();
  for (const pullRequest of pullRequests) {
    const current = byURL.get(pullRequest.url);
    if (!current) {
      byURL.set(pullRequest.url, { ...pullRequest, sourceServerIds: [pullRequest.serverId] });
      continue;
    }
    const preferred = !current.worktreePath && pullRequest.worktreePath ? pullRequest : current;
    byURL.set(pullRequest.url, {
      ...preferred,
      stack: preferred.stack !== undefined ? preferred.stack : current.stack !== undefined ? current.stack : pullRequest.stack,
      sourceServerIds: [...new Set([
        ...(current.sourceServerIds ?? [current.serverId]),
        ...(pullRequest.sourceServerIds ?? [pullRequest.serverId]),
      ])],
    });
  }
  return orderPullRequests([...byURL.values()]);
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

function hostedCacheId(organizationId: string) {
  return `github:${organizationId}`;
}

export function PullRequests({
  servers,
  workspaces,
  onOpenThread,
  onOpenWorkspace,
  hostedOrganizationId,
  hostedOrganizationIds,
}: {
  servers: Server[];
  workspaces: Workspace[];
  onOpenThread: (id: string) => void;
  onOpenWorkspace: (id: string) => void;
  hostedOrganizationId?: string;
  hostedOrganizationIds?: string[];
}) {
  const hostedIds = hostedOrganizationIds
    ?? (hostedOrganizationId ? [hostedOrganizationId] : []);
  const hosted = hostedIds.length > 0;
  const hostedCacheIds = hostedIds.map(hostedCacheId);
  const serverIds = hosted
    ? hostedCacheIds
    : servers.filter((server) => !server.workspaceOnly).map((server) => server.id).sort();
  const serverKey = hosted
    ? hostedIds.slice().sort().join("\u0000")
    : servers
      .filter((server) => !server.workspaceOnly)
      .map((server) => `${server.id}:${server.online ? "online" : "offline"}`)
      .sort()
      .join("\u0000");
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const hostedIdsRef = useRef(hostedIds);
  hostedIdsRef.current = hostedIds;
  const [pullRequests, setPullRequests] = useState<AuthoredPullRequest[]>(() => cachedPullRequests(serverIds));
  const [filter, setFilter] = useState<PullRequestFilter>(hosted ? "all" : "needs");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(!hasCachedPullRequests(serverIds));
  const [githubError, setGithubError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedURL, setSelectedURL] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
      return new Set(Array.isArray(stored) ? stored.filter((value) => typeof value === "string") : []);
    } catch {
      return new Set();
    }
  });
  const requestId = useRef(0);
  const progressRequestId = useRef<number | undefined>(undefined);

  const load = useCallback(async ({ refresh = false, showProgress = false } = {}) => {
    const currentRequest = ++requestId.current;
    if (showProgress) {
      progressRequestId.current = currentRequest;
      setRefreshing(true);
    }
    if (hosted) {
      const cacheIds = hostedIdsRef.current.map(hostedCacheId);
      const cached = cachedPullRequests(cacheIds);
      if (hasCachedPullRequests(cacheIds)) {
        setPullRequests(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
      const batches: Array<{ serverId: string; pullRequests: AuthoredPullRequest[] } | { serverId: string; error: string }> =
        await Promise.all(hostedIdsRef.current.map(async (organizationId) => {
        const serverId = hostedCacheId(organizationId);
        try {
          const response = await hubRequest<{ pullRequests: AuthoredPullRequest[] }>(
            `${hubThreadBase(organizationId)}/github/pull-requests${refresh ? "?refresh=1" : ""}`,
          );
          return {
            serverId,
            pullRequests: (response.pullRequests ?? []).map((pullRequest) => ({
              ...pullRequest,
              serverId,
            })),
          };
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : "Connect GitHub to see pull requests.";
          if (caught instanceof HubRequestError && caught.status === 409) {
            const known = pullRequestCache.get(serverId);
            if (known?.length) return { serverId, pullRequests: known };
          }
          return { serverId, error: message };
        }
      }));
      if (currentRequest !== requestId.current) {
        if (progressRequestId.current === currentRequest) {
          progressRequestId.current = undefined;
          setRefreshing(false);
        }
        return;
      }
      const errors = batches.flatMap((batch) => ("error" in batch && batch.error ? [batch.error] : []));
      for (const batch of batches) {
        if ("pullRequests" in batch) cachePullRequests(batch.serverId, batch.pullRequests);
      }
      const next = cachedPullRequests(cacheIds);
      if (next.length > 0 || errors.length < batches.length) {
        setPullRequests(next);
        setGithubError("");
      } else {
        setPullRequests([]);
        setGithubError(errors[0] || "Connect GitHub to see pull requests.");
      }
      setLoading(false);
      if (progressRequestId.current === currentRequest) {
        progressRequestId.current = undefined;
        setRefreshing(false);
      }
      return;
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
  }, [hosted, serverKey]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), PULL_REQUEST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load, serverKey]);

  useEffect(() => transport.subscribe((source, payload) => {
    if (!serversRef.current.some((server) => server.id === source) || !payload || typeof payload !== "object") return;
    if ((payload as { type?: unknown }).type === "pull-requests") void load({ refresh: true });
  }, ["pull-requests", "sidebar"]), [load]);

  const chats = useStore(useShallow((state) => state.chats));
  const onlineCount = servers.filter((server) => !server.workspaceOnly && server.online).length;
  const computerCount = servers.filter((server) => !server.workspaceOnly).length;
  const yours = (pullRequest: AuthoredPullRequest) => Boolean(pullRequest.worktreePath);
  const failing = (pullRequest: AuthoredPullRequest) =>
    pullRequest.checks.some((check) => check.state === "fail") || pullRequest.reviewDecision === "CHANGES_REQUESTED";
  const waiting = (pullRequest: AuthoredPullRequest) =>
    pullRequest.reviewDecision === "REVIEW_REQUIRED" && !yours(pullRequest) && !failing(pullRequest);
  const activity = (pullRequest: AuthoredPullRequest) =>
    pullRequest.hasUnreadActivity && yours(pullRequest) && !failing(pullRequest);
  const ready = (pullRequest: AuthoredPullRequest) =>
    yours(pullRequest) && pullRequest.reviewDecision === "APPROVED" && !failing(pullRequest) && !pullRequest.isDraft;

  const counts = useMemo(() => ({
    needs: pullRequests.filter((pullRequest) => failing(pullRequest) || waiting(pullRequest) || activity(pullRequest) || ready(pullRequest)).length,
    yours: pullRequests.filter(yours).length,
    review: pullRequests.filter((pullRequest) => pullRequest.reviewDecision === "REVIEW_REQUIRED" && !yours(pullRequest)).length,
    all: pullRequests.length,
  }), [pullRequests]);
  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return pullRequests.filter((pullRequest) => {
      const matchesFilter = filter === "all"
        || (filter === "yours" && yours(pullRequest))
        || (filter === "review" && pullRequest.reviewDecision === "REVIEW_REQUIRED" && !yours(pullRequest))
        || (filter === "needs" && (failing(pullRequest) || waiting(pullRequest) || activity(pullRequest) || ready(pullRequest)));
      if (!matchesFilter) return false;
      if (!normalizedQuery) return true;
      return [pullRequest.title, pullRequest.repository, pullRequest.headRefName, `#${pullRequest.number}`, pullRequest.workspaceName]
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [filter, pullRequests, query]);
  const selected = pullRequests.find((pullRequest) => pullRequest.url === selectedURL);
  const groupedWorkspaces = useMemo(() => workspaceGroups(workspaces, servers), [servers, workspaces]);
  const workspaceGroupByCopy = useMemo(() => new Map<string, WorkspaceGroup>(
    groupedWorkspaces.flatMap((group) => group.copies.map((workspace) => [
      `${workspace.serverId}:${workspace.id}`,
      group,
    ] as const)),
  ), [groupedWorkspaces]);
  const selectedWorkspace = selected && workspaces.find((entry) =>
    entry.serverId === selected.serverId && entry.id === selected.workspaceId);
  const selectedWorkspaceGroup = selected && workspaceGroupByCopy.get(`${selected.serverId}:${selected.workspaceId}`);
  const selectedServer = selected && servers.find((entry) => entry.id === selected.serverId);
  const selectedDetailServerId = selected && (
    servers.find((entry) => entry.local && entry.online && selected.sourceServerIds?.includes(entry.id))?.id
    ?? selected.serverId
  );
  const selectedThread = selected && activeThread(selected, chats);
  const needGroups = [
    { key: "failing", label: "Failing or blocked", tone: "bg-destructive", rows: visible.filter(failing) },
    { key: "waiting", label: "Waiting for your review", tone: "bg-warning", rows: visible.filter((pullRequest) => waiting(pullRequest) && !failing(pullRequest)) },
    { key: "activity", label: "New activity on yours", tone: "bg-primary", rows: visible.filter((pullRequest) => activity(pullRequest) && !waiting(pullRequest)) },
    { key: "ready", label: "Ready to merge", tone: "bg-success-foreground", rows: visible.filter((pullRequest) => ready(pullRequest) && !activity(pullRequest) && !waiting(pullRequest)) },
  ].filter((group) => group.rows.length > 0);

  function toggleSection(key: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  if (selected && hosted) {
    return (
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-3 px-4">
          <SidebarTrigger className="md:hidden" />
          <Button variant="ghost" size="sm" onClick={() => setSelectedURL("")}>Pull requests</Button>
          <a className="ml-auto text-sm" href={selected.url} target="_blank" rel="noreferrer" data-link>Open on GitHub</a>
        </header>
        <div className="mx-auto flex w-full max-w-6xl gap-8 px-6 py-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{selected.repository} #{selected.number}</p>
            <h1 className="mt-3 text-2xl font-semibold">{selected.title}</h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground">{selected.headRefName} → {selected.baseRefName}</p>
            <section className="mt-8">
              <h2 className="text-sm font-medium">Description</h2>
              <p className="mt-3 whitespace-pre-wrap text-sm">{selected.body?.trim() || "No description."}</p>
            </section>
          </div>
          <aside className="w-72 shrink-0">
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground">CHECKS</h2>
            <div className="mt-2 flex flex-col gap-1.5">
              {selected.checks.map((check) => (
                <p key={check.name} className="text-xs">{check.name}</p>
              ))}
              {selected.checks.length === 0 && <p className="text-xs text-muted-foreground">No checks yet.</p>}
            </div>
          </aside>
        </div>
      </main>
    );
  }

  if (selected) {
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <PullRequestView
          key={selected.url}
          serverId={selectedDetailServerId ?? selected.serverId}
          repository={selected.repository}
          number={selected.number}
          stack={selected.stack}
          onPullRequestChanged={() => void load({ refresh: true })}
          leadingActions={(
            <Button variant="ghost" size="sm" onClick={() => setSelectedURL("")}>
              Pull requests
            </Button>
          )}
          actions={(
            <>
              {selectedWorkspace && (
                <Button variant="ghost" size="sm" data-link className="max-w-48" onClick={() => onOpenWorkspace(selectedWorkspace.id)}>
                  <WorkspaceMark home={false} workspace={selectedWorkspace} server={selectedServer} size="sm" />
                  <span className="truncate">{selectedWorkspaceGroup?.workspace.name ?? selected.workspaceName}</span>
                </Button>
              )}
              {selectedThread && (
                <Button variant="secondary" size="sm" data-link onClick={() => onOpenThread(selectedThread.id)}>
                  <CircleDot />
                  Open thread
                </Button>
              )}
            </>
          )}
        />
      </main>
    );
  }

  const rows = (pullRequest: AuthoredPullRequest) => (
    <PullRequestListItem
      key={pullRequest.url}
      pullRequest={pullRequest}
      workspace={workspaces.find((entry) => entry.serverId === pullRequest.serverId && entry.id === pullRequest.workspaceId)}
      server={servers.find((entry) => entry.id === pullRequest.serverId)}
      thread={linkedThread(pullRequest, chats)}
      onOpen={() => setSelectedURL(pullRequest.url)}
      onOpenThread={onOpenThread}
    />
  );

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4">
        <SidebarTrigger className="md:hidden" />
        <h1 className="text-sm font-medium">Pull requests</h1>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-success-foreground" />
          {hosted
            ? "Live from GitHub"
            : `Live from GitHub · ${onlineCount} of ${computerCount} ${computerCount === 1 ? "computer" : "computers"}`}
        </span>
        <Button variant="ghost" size="icon-sm" disabled={refreshing} onClick={() => void load({ refresh: true, showProgress: true })} aria-label="Refresh pull requests">
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
        </Button>
      </header>
      <div className="flex items-center gap-3 px-4 pb-3">
        <ToggleGroup
          type="single"
          size="sm"
          value={filter}
          onValueChange={(value) => value && setFilter(value as PullRequestFilter)}
          aria-label="Filter pull requests"
        >
          {([
            ["needs", "Needs you"],
            ["yours", "Yours"],
            ["review", "Review requested"],
            ["all", "All"],
          ] as const).map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} className="px-2.5">
              {label} <span className="text-muted-foreground">{counts[value]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <InputGroup className="ml-auto w-64">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pull requests" aria-label="Search pull requests" />
        </InputGroup>
      </div>
      {loading ? (
        <PullRequestListLoading />
      ) : visible.length === 0 ? (
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
            <EmptyTitle>{pullRequests.length === 0 ? "No pull requests" : "No matching pull requests"}</EmptyTitle>
            <EmptyDescription>
              {githubError
                ? githubError
                : pullRequests.length === 0
                ? "An agent opens one from a thread."
                : "Try another search or filter."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col pb-6">
            {(filter === "needs" ? needGroups : [{ key: filter, label: "", tone: "", rows: visible }]).map((group) => (
              <section key={group.key}>
                {group.label ? (
                  <button type="button" className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs" onClick={() => toggleSection(group.key)}>
                    <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", collapsed.has(group.key) && "-rotate-90")} />
                    <span className={cn("size-1.5 rounded-full", group.tone)} />
                    <span>{group.label}</span>
                    <span className="text-muted-foreground">{group.rows.length}</span>
                  </button>
                ) : null}
                {collapsed.has(group.key) ? null : group.rows.map(rows)}
              </section>
            ))}
          </div>
        </ScrollArea>
      )}
    </main>
  );
}

function linkedThread(pullRequest: AuthoredPullRequest, chats: Chat[]): Chat | undefined {
  if (!pullRequest.worktreePath) return undefined;
  return chats
    .filter((chat) => chat.serverId === pullRequest.serverId && inside(chat.cwd, pullRequest.worktreePath!))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
}

function PullRequestListItem({
  pullRequest,
  workspace,
  server,
  thread,
  onOpen,
  onOpenThread,
}: {
  pullRequest: AuthoredPullRequest;
  workspace?: Workspace;
  server?: Server;
  thread?: Chat;
  onOpen: () => void;
  onOpenThread: (id: string) => void;
}) {
  const passed = pullRequest.checks.filter((check) => check.state === "pass" || check.state === "skipping").length;
  const failed = pullRequest.checks.some((check) => check.state === "fail");
  const total = pullRequest.checks.length;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_11rem_4.5rem_6.5rem_3rem] items-center gap-3 px-4 py-2 hover:bg-accent/60">
      <button type="button" data-link className="flex min-w-0 items-start gap-2 text-left" onClick={onOpen}>
        <GitPullRequest className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block truncate text-sm">{pullRequest.title}</span>
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <span className="shrink-0">#{pullRequest.number}</span>
            {workspace ? <WorkspaceMark home={false} workspace={workspace} server={server} size="sm" /> : null}
            <span className="truncate">{pullRequest.workspaceName}</span>
            <span className="truncate font-mono">{pullRequest.headRefName}</span>
            {pullRequest.stack ? (
              <span className="shrink-0">{pullRequest.stack.position} of {pullRequest.stack.size} in stack</span>
            ) : null}
          </span>
        </span>
      </button>
      {thread ? (
        <button type="button" data-link className="flex min-w-0 items-center gap-1.5 text-xs" onClick={() => onOpenThread(thread.id)}>
          <CircleDot className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{thread.title}</span>
        </button>
      ) : <span />}
      <span className="flex items-center justify-end gap-1 font-mono text-xs text-muted-foreground">
        {failed ? <X className="size-3.5 text-destructive" /> : <Check className="size-3.5 text-success-foreground" />}
        {total > 0 ? `${passed}/${total}` : "—"}
      </span>
      <span className="text-right font-mono text-xs">
        <span className="text-success-foreground">+{pullRequest.additions}</span>{" "}
        <span className="text-destructive">−{pullRequest.deletions}</span>
      </span>
      <span className="text-right text-xs text-muted-foreground">{relativeDate(pullRequest.updatedAt)}</span>
    </div>
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
