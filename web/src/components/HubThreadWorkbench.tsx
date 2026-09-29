import { useCallback, useEffect, useState, type ReactNode, type RefObject } from "react";
import { Activity, ChevronLeft, GitPullRequest, MessagesSquare, Plus } from "lucide-react";
import type { ConvEntry } from "@/state/types";
import type { Route } from "@/lib/route";
import {
  activateTab,
  closeTab,
  cycleTab,
  findTab,
  flattenWorkbench,
  focusedGroup,
  openTab,
  tabId,
  updateWorkbench,
  useWorkbench,
  type WorkbenchTab,
} from "@/lib/thread-workbench";
import { githubPullRequestTarget } from "@/hooks/use-thread-tools";
import { threadActivities } from "@/lib/thread-activity";
import { HubRequestError, hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { TabClose, TabCloseSpace, TabStrip, WorkbenchTabTrigger, tabContentClass, tabListClass } from "@/components/WorkbenchTabs";
import { ThreadActivityTool } from "@/components/ThreadActivity";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Markdown } from "@/components/Markdown";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/// Tabs open for one hosted thread on this device. Back returns to the thread,
/// then to the list. The address keeps naming the thread.
export function HubThreadWorkbench({
  threadId,
  title,
  state,
  organizationId,
  entries,
  provider,
  working,
  connected,
  revision,
  sidebar,
  transcriptRef,
  followsLatest,
  onBack,
  navigate,
  notice,
  actions,
  children,
}: {
  threadId: string;
  title: string;
  state?: string;
  organizationId: string;
  entries: ConvEntry[];
  provider: string;
  working: boolean;
  connected: boolean;
  revision: number;
  sidebar: boolean;
  transcriptRef: RefObject<HTMLDivElement | null>;
  followsLatest: { current: boolean };
  onBack: () => void;
  navigate: (route: Route) => void;
  notice?: ReactNode;
  actions?: ReactNode;
  children: (api: { openLink: (href: string) => void }) => ReactNode;
}) {
  const workbench = useWorkbench(threadId);
  const shown = flattenWorkbench(workbench);
  const front = focusedGroup(workbench).active;

  useEffect(() => {
    updateWorkbench(threadId, (current) => findTab(current, threadId) ? current : openTab(current, { kind: "thread", threadId }));
  }, [threadId]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (front !== threadId || !followsLatest.current || !node || node.clientHeight === 0) return;
    node.scrollTop = node.scrollHeight;
  }, [front, threadId, revision, transcriptRef, followsLatest]);

  const change = useCallback((id: string) => {
    updateWorkbench(threadId, (current) => activateTab(current, id));
  }, [threadId]);

  const openLink = useCallback((href: string) => {
    const pull = githubPullRequestTarget(href);
    if (!pull) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    updateWorkbench(threadId, (current) => openTab(current, {
      kind: "pull-request",
      threadId,
      repository: pull.repository,
      number: pull.number,
    }));
  }, [threadId]);

  useEffect(() => {
    const switchTab = (event: KeyboardEvent) => {
      if (!event.metaKey || !event.shiftKey || event.altKey || event.ctrlKey) return;
      const direction = event.code === "BracketRight" ? 1 : event.code === "BracketLeft" ? -1 : undefined;
      if (!direction) return;
      event.preventDefault();
      updateWorkbench(threadId, (current) => cycleTab(current, direction));
    };
    window.addEventListener("keydown", switchTab);
    return () => window.removeEventListener("keydown", switchTab);
  }, [threadId]);

  const back = () => {
    if (front !== threadId && findTab(workbench, threadId)) {
      change(threadId);
      return;
    }
    onBack();
  };

  const add = (tab: WorkbenchTab) => {
    updateWorkbench(threadId, (current) => openTab(current, tab));
  };

  return (
    <Tabs value={front} onValueChange={change} className="min-h-0 min-w-0 flex-1 gap-0">
      <TabStrip actions={actions}>
        {sidebar && <SidebarTrigger className="md:hidden" />}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label="Back" data-link onClick={back}>
              <ChevronLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back</TooltipContent>
        </Tooltip>
        <TabsList aria-label="Open tabs" className={tabListClass}>
          {shown.tabs.map((tab) => {
            const id = tabId(tab);
            const label = tabLabel(tab, title);
            const closable = tab.kind !== "thread" && shown.tabs.length > 1;
            return (
              <div key={id} className="group/tab flex h-8 min-w-0 shrink-0 items-center">
                <WorkbenchTabTrigger
                  icon={<TabIcon tab={tab} />}
                  label={label}
                  value={id}
                  title={label}
                  aria-keyshortcuts="Meta+Shift+[ Meta+Shift+]"
                  className={closable ? "pr-1" : undefined}
                >
                  {tab.kind === "thread" && <ThreadDot state={state} />}
                  {closable && <TabCloseSpace />}
                </WorkbenchTabTrigger>
                {closable && <TabClose label={label} active={id === front} onClose={() => updateWorkbench(threadId, (current) => closeTab(current, id))} />}
              </div>
            );
          })}
        </TabsList>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label="Add tab">
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Add tab</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => add({ kind: "activity", threadId })}>
              <Activity />
              Running work
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => {
              const pull = latestPullRequest(entries);
              add({
                kind: "pull-request",
                threadId,
                ...(pull ? { repository: pull.repository, number: pull.number } : {}),
              });
            }}>
              <GitPullRequest />
              Pull request
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TabStrip>
      {notice}
      {shown.tabs.map((tab) => {
        const id = tabId(tab);
        return (
          <TabsContent key={id} value={id} forceMount className={tabContentClass}>
            {tab.kind === "thread" ? children({ openLink }) : tab.kind === "activity" ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <ThreadActivityTool activities={threadActivities(entries, provider, working, connected)} connected={connected} />
              </div>
            ) : tab.kind === "pull-request" ? (
              <PullRequestTab
                organizationId={organizationId}
                repository={tab.repository}
                number={tab.number}
                navigate={navigate}
              />
            ) : (
              <Empty className="min-h-0 flex-1">
                <EmptyHeader>
                  <EmptyTitle>This tab is unavailable</EmptyTitle>
                  <EmptyDescription>Close it and open another.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

function tabLabel(tab: WorkbenchTab, title: string): string {
  if (tab.kind === "thread") return title || "Thread";
  if (tab.kind === "pull-request") return tab.number ? `Pull request #${tab.number}` : "Pull request";
  if (tab.kind === "activity") return "Running work";
  if (tab.kind === "terminal") return "Terminal";
  if (tab.kind === "browser") return "Browser";
  if (tab.kind === "analytics") return "Analytics";
  if (tab.kind === "performance") return "Performance";
  return "Tab";
}

function TabIcon({ tab }: { tab: WorkbenchTab }) {
  const className = "size-3.5 shrink-0";
  if (tab.kind === "pull-request") return <GitPullRequest className={className} />;
  if (tab.kind === "activity") return <Activity className={className} />;
  return <MessagesSquare className={className} />;
}

function ThreadDot({ state }: { state?: string }) {
  if (state !== "working" && state !== "needs_input" && state !== "error") return null;
  const label = state === "needs_input" ? "Needs you" : state === "working" ? "Working" : "Error";
  const tone = state === "needs_input"
    ? "bg-warning"
    : state === "working"
      ? "bg-info animate-pulse motion-reduce:animate-none"
      : "bg-destructive";
  return <span role="img" aria-label={label} className={cn("size-1.5 shrink-0 rounded-full", tone)} />;
}

/// The last GitHub pull request named in the thread, which is the one to open.
function latestPullRequest(entries: ConvEntry[]): { repository: string; number: number } | undefined {
  let found: { repository: string; number: number } | undefined;
  for (const entry of entries) {
    const blob = [entry.text, entry.output, entry.arg].filter((value): value is string => typeof value === "string").join("\n");
    for (const match of blob.matchAll(/https?:\/\/github\.com\/[^\s)>]+/gi)) {
      const pull = githubPullRequestTarget(match[0].replace(/[)\].,>]+$/, ""));
      if (pull) found = pull;
    }
  }
  return found;
}

function PullRequestTab({
  organizationId,
  repository,
  number,
  navigate,
}: {
  organizationId: string;
  repository?: string;
  number?: number;
  navigate: (route: Route) => void;
}) {
  const [pull, setPull] = useState<{ title: string; url: string; body?: string; state?: string; isDraft?: boolean } | null>();
  const [error, setError] = useState("");
  const [status, setStatus] = useState<number>();

  useEffect(() => {
    if (!repository || !number) return;
    let live = true;
    setPull(undefined);
    setError("");
    setStatus(undefined);
    hubRequest<{ pullRequests?: { title?: string; url?: string; body?: string; state?: string; isDraft?: boolean; repository?: string; number?: number }[] }>(
      `${hubThreadBase(organizationId)}/github/pull-requests`,
    ).then((response) => {
      if (!live) return;
      const match = (response.pullRequests ?? []).find((item) => item.repository?.toLowerCase() === repository.toLowerCase() && item.number === number);
      setPull(match?.title && match.url ? { title: match.title, url: match.url, body: match.body, state: match.state, isDraft: match.isDraft } : null);
    }, (caught: unknown) => {
      if (!live) return;
      setStatus(caught instanceof HubRequestError ? caught.status : undefined);
      setError(caught instanceof Error ? caught.message : "Couldn't open this pull request.");
      setPull(null);
    });
    return () => { live = false; };
  }, [organizationId, repository, number]);

  if (!repository || !number) {
    return (
      <Empty className="min-h-0 flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
          <EmptyTitle>No pull request</EmptyTitle>
          <EmptyDescription>Open a pull request link in the thread.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const github = `https://github.com/${repository}/pull/${number}`;
  const open = () => navigate({ name: "prs", organizationId, repository, number });

  return (
    <section aria-label="Pull request" className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-[44rem] flex-col gap-4 px-6 py-7">
        <p className="font-mono text-sm text-muted-foreground">{repository} #{number}</p>
        {pull === undefined && !error && <Spinner aria-label="Loading pull request" className="text-muted-foreground motion-reduce:animate-none" />}
        {error && status === 409 && (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
              <EmptyTitle>GitHub is not connected</EmptyTitle>
              <EmptyDescription>Connect GitHub to open this pull request.</EmptyDescription>
            </EmptyHeader>
            <div className="flex flex-wrap justify-center gap-2">
              <Button data-link onClick={() => navigate({ name: "settings", tab: "connections", organizationId })}>Connect GitHub</Button>
              <Button variant="outline" asChild>
                <a href={github} target="_blank" rel="noreferrer" data-link>Open on GitHub</a>
              </Button>
            </div>
          </Empty>
        )}
        {error && status !== 409 && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {pull && (
          <>
            <h2 className="text-lg font-medium whitespace-normal break-words">{pull.title}</h2>
            <p className="text-sm text-muted-foreground">{pull.isDraft ? "Draft" : pull.state === "MERGED" ? "Merged" : pull.state === "CLOSED" ? "Closed" : "Open"}</p>
          </>
        )}
        {status !== 409 && <div className="flex flex-wrap gap-2">
          <Button data-link onClick={open}>Open pull request</Button>
          <Button variant="outline" asChild>
            <a href={pull?.url ?? github} target="_blank" rel="noreferrer" data-link>Open on GitHub</a>
          </Button>
        </div>}
        {pull?.body && <Markdown text={pull.body} />}
      </div>
    </section>
  );
}
