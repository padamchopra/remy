import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleCheck,
  CircleDot,
  CircleX,
  ExternalLink,
  FileDiff,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PaneHeader } from "@/components/PaneHeader";
import { PullRequestDiff } from "@/components/PullRequestDiff";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { transport } from "@/lib/transport";
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
  checks: PullRequestCheck[];
  unreadComments: unknown[];
  hasUnreadActivity: boolean;
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  worktreePath: string | null;
  serverId: string;
}

function mergePullRequests(pullRequests: AuthoredPullRequest[]): AuthoredPullRequest[] {
  const byURL = new Map<string, AuthoredPullRequest>();
  for (const pullRequest of pullRequests) {
    const current = byURL.get(pullRequest.url);
    if (!current || (!current.worktreePath && pullRequest.worktreePath)) {
      byURL.set(pullRequest.url, pullRequest);
    }
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
  if (!Number.isFinite(elapsed)) return "Updated recently";
  const minutes = Math.max(0, Math.round(elapsed / 60_000));
  if (minutes < 1) return "Updated now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.round(hours / 24);
  return `Updated ${days}d ago`;
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
  const [pullRequests, setPullRequests] = useState<AuthoredPullRequest[]>([]);
  const [filter, setFilter] = useState<PullRequestFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<AuthoredPullRequest>();

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    const available = servers.filter((server) => server.online && !server.workspaceOnly);
    const batches = await Promise.all(available.map(async (server) => {
      try {
        const response = await transport.request<{ pullRequests?: Omit<AuthoredPullRequest, "serverId">[] }>(
          server.id,
          `/pull-requests${refresh ? "?refresh=1" : ""}`,
        );
        return (response.pullRequests ?? []).map((pullRequest) => ({ ...pullRequest, serverId: server.id }));
      } catch {
        return [];
      }
    }));
    setPullRequests(mergePullRequests(batches.flat()));
    setLoading(false);
    setRefreshing(false);
  }, [servers]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => ({
    all: pullRequests.length,
    ready: pullRequests.filter((pullRequest) => !pullRequest.isDraft).length,
    draft: pullRequests.filter((pullRequest) => pullRequest.isDraft).length,
  }), [pullRequests]);
  const visible = pullRequests.filter((pullRequest) =>
    filter === "all" || (filter === "draft" ? pullRequest.isDraft : !pullRequest.isDraft));

  if (selected) {
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <PaneHeader
          crumbs={[
            { label: "Pull requests", onClick: () => setSelected(undefined) },
            { label: `#${selected.number}` },
            { label: "Changes" },
          ]}
        >
          <Button asChild size="sm" variant="outline">
            <a href={selected.url} target="_blank" rel="noreferrer" data-link>
              <ExternalLink />
              Open on GitHub
            </a>
          </Button>
        </PaneHeader>
        <div className="min-h-0 flex-1">
          <PullRequestDiff
            serverId={selected.serverId}
            repository={selected.repository}
            number={selected.number}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <PaneHeader
        crumbs={[{ label: "Pull requests" }]}
        tabs={(
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={filter}
            onValueChange={(value) => value && setFilter(value as PullRequestFilter)}
            aria-label="Filter pull requests"
          >
            <ToggleGroupItem value="all">All {counts.all}</ToggleGroupItem>
            <ToggleGroupItem value="ready">Ready {counts.ready}</ToggleGroupItem>
            <ToggleGroupItem value="draft">Draft {counts.draft}</ToggleGroupItem>
          </ToggleGroup>
        )}
      >
        <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void load(true)}>
          <RefreshCw className={refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </PaneHeader>

      {loading ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
            <EmptyTitle className="shimmer">Loading pull requests…</EmptyTitle>
            <EmptyDescription>Reading your GitHub workspaces.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : visible.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
            <EmptyTitle>{filter === "all" ? "No pull requests" : `No ${filter} pull requests`}</EmptyTitle>
            <EmptyDescription>
              {filter === "all"
                ? "Open one from a GitHub workspace you added to Remy."
                : `Switch filters to see your other pull requests.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ItemGroup className="gap-2 p-4">
            {visible.map((pullRequest) => {
              const workspace = workspaces.find((entry) =>
                entry.serverId === pullRequest.serverId && entry.id === pullRequest.workspaceId);
              const server = servers.find((entry) => entry.id === pullRequest.serverId);
              const thread = activeThread(pullRequest, chats);
              const failed = pullRequest.checks.filter((check) => check.state === "fail").length;
              const pending = pullRequest.checks.filter((check) => check.state === "pending").length;
              const passed = pullRequest.checks.filter((check) => check.state === "pass").length;
              return (
                <Item key={pullRequest.url} variant="outline" className="items-start">
                  <ItemMedia variant="icon">
                    <GitPullRequest />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <Button asChild variant="link" className="h-auto min-w-0 justify-start p-0 text-sm font-medium">
                        <a href={pullRequest.url} target="_blank" rel="noreferrer" data-link>
                          <span className="truncate">{pullRequest.title}</span>
                          <ExternalLink className="size-3" />
                        </a>
                      </Button>
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">#{pullRequest.number}</span>
                    </ItemTitle>
                    <ItemDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="inline-flex items-center gap-1"><GitBranch className="size-3" />{pullRequest.headRefName}</span>
                      <span>{relativeDate(pullRequest.updatedAt)}</span>
                      <span>{pullRequest.repository}</span>
                    </ItemDescription>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant={pullRequest.isDraft ? "secondary" : "success"}>
                        {pullRequest.isDraft ? "Draft" : "Ready"}
                      </Badge>
                      {pullRequest.reviewDecision === "APPROVED" && (
                        <Badge variant="success"><CircleCheck />Approved</Badge>
                      )}
                      {pullRequest.reviewDecision === "CHANGES_REQUESTED" && (
                        <Badge variant="destructive"><CircleX />Changes requested</Badge>
                      )}
                      {failed > 0 ? (
                        <Badge variant="destructive"><CircleX />{failed} failed</Badge>
                      ) : pending > 0 ? (
                        <Badge variant="warning"><CircleDot />{pending} pending</Badge>
                      ) : pullRequest.checks.length > 0 ? (
                        <Badge variant="outline"><CircleCheck />{passed}/{pullRequest.checks.length} checks</Badge>
                      ) : null}
                      {pullRequest.hasUnreadActivity && (
                        <Badge variant="warning"><MessageSquare />New activity</Badge>
                      )}
                    </span>
                  </ItemContent>
                  <ItemActions className="shrink-0 flex-wrap justify-end">
                    <Button variant="outline" size="sm" data-link onClick={() => setSelected(pullRequest)}>
                      <FileDiff />
                      Changes
                    </Button>
                    {workspace && (
                      <Button
                        variant="ghost"
                        size="sm"
                        data-link
                        onClick={() => onOpenWorkspace(workspace.id)}
                      >
                        <WorkspaceMark home={false} workspace={workspace} server={server} size="sm" />
                        {pullRequest.workspaceName}
                      </Button>
                    )}
                    {thread && (
                      <Button variant="outline" size="sm" data-link onClick={() => onOpenThread(thread.id)}>
                        <CircleDot className="text-success" />
                        Open active thread
                      </Button>
                    )}
                  </ItemActions>
                </Item>
              );
            })}
          </ItemGroup>
        </ScrollArea>
      )}
    </main>
  );
}
