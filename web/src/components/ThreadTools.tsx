import { lazy, Suspense } from "react";
import { Activity, ChartNoAxesCombined, Gauge, GitPullRequest, Globe2, Plus, X } from "lucide-react";
import { SurfaceLoading } from "@/components/Deferred";
import { ThreadActivityTool } from "@/components/ThreadActivity";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SharedBrowserView, ThreadToolTab } from "@/hooks/use-thread-tools";
import type { ChatCodeReference, ThreadActivity } from "@/state/types";

// A tool is only worth its code once somebody opens it, and the tab bar has to
// draw before any of them has arrived. Running work is the exception: it is the
// first thing in the launcher and costs almost nothing, so it ships with these
// tabs rather than after them.
const SharedBrowser = lazy(() => import("@/components/SharedBrowser").then((module) => ({
  default: module.SharedBrowser,
})));
const PullRequestView = lazy(() => import("@/components/PullRequestView").then((module) => ({
  default: module.PullRequestView,
})));
const ThreadAnalyticsTool = lazy(() => import("@/components/ThreadInsights").then((module) => ({
  default: module.ThreadAnalyticsTool,
})));
const ThreadPerformanceTool = lazy(() => import("@/components/ThreadInsights").then((module) => ({
  default: module.ThreadPerformanceTool,
})));

export function ThreadToolsSidebar({
  chatId,
  serverId,
  tabs,
  activeTab,
  views,
  setActiveTab,
  setView,
  addBrowser,
  addAnalytics,
  addPerformance,
  addPullRequest,
  addActivity,
  activities,
  activityConnected,
  codeReferences,
  onAddReference,
  onRemoveReference,
  canAddBrowser,
  closeTab,
  visible,
}: {
  chatId: string;
  serverId: string;
  tabs: ThreadToolTab[];
  activeTab: string;
  views: Record<string, SharedBrowserView | undefined>;
  setActiveTab: (id: string) => void;
  setView: (id: string, view: SharedBrowserView) => void;
  addBrowser: () => void;
  addAnalytics: () => void;
  addPerformance: () => void;
  addPullRequest: () => void;
  addActivity: () => void;
  activities: ThreadActivity[];
  activityConnected: boolean;
  codeReferences: ChatCodeReference[];
  onAddReference: (reference: ChatCodeReference) => void;
  onRemoveReference: (id: string) => void;
  canAddBrowser: boolean;
  closeTab: (tab: ThreadToolTab) => Promise<void>;
  visible: boolean;
}) {
  return (
    <section aria-label="Thread tools" className="flex size-full min-h-0 flex-col bg-background">
      {tabs.length > 0 ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 gap-0">
          <TabsList variant="line" aria-label="Open tools" className="h-10 w-full min-w-0 justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-none border-b border-border px-2 py-0">
            {tabs.map((tab) => {
              const typeIndex = tabs.filter((candidate) => candidate.type === tab.type).findIndex((candidate) => candidate.id === tab.id);
              const label = toolLabel(tab, typeIndex);
              const Icon = toolIcon(tab.type);
              return (
                <div key={tab.id} className="flex h-full min-w-0 shrink-0 items-center">
                  <TabsTrigger value={tab.id} className="min-w-0 max-w-36 shrink px-2 after:bottom-0!">
                    <Icon />
                    <span className="truncate">{label}</span>
                    {views[tab.id]?.active && <span className="size-1.5 shrink-0 rounded-full bg-success-foreground" />}
                  </TabsTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Close ${label} tab`}
                    onClick={() => void closeTab(tab)}
                  >
                    <X />
                  </Button>
                </div>
              );
            })}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Add tool tab"
                >
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={addActivity}>
                    <Activity />
                    Running work
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={addBrowser} disabled={!canAddBrowser}>
                    <Globe2 />
                    Browser
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={addAnalytics}>
                    <ChartNoAxesCombined />
                    Analytics
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={addPerformance}>
                    <Gauge />
                    Performance
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={addPullRequest}>
                    <GitPullRequest />
                    Pull request
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="min-h-0 overflow-hidden">
              <Suspense fallback={<SurfaceLoading />}>
                {tab.type === "browser" ? (
                  <SharedBrowser
                    chatId={chatId}
                    serverId={serverId}
                    browserId={tab.id}
                    view={views[tab.id]}
                    setView={(view) => setView(tab.id, view)}
                  />
                ) : tab.type === "analytics" ? (
                  <ThreadAnalyticsTool chatId={chatId} serverId={serverId} enabled={visible && activeTab === tab.id} />
                ) : tab.type === "performance" ? (
                  <ThreadPerformanceTool chatId={chatId} serverId={serverId} enabled={visible && activeTab === tab.id} />
                ) : tab.type === "activity" ? (
                  <ThreadActivityTool activities={activities} connected={activityConnected} />
                ) : (
                  <PullRequestView
                    chatId={tab.repository && tab.pullRequestNumber ? undefined : chatId}
                    serverId={serverId}
                    repository={tab.repository}
                    number={tab.pullRequestNumber}
                    codeReferences={codeReferences}
                    onAddReference={onAddReference}
                    onRemoveReference={onRemoveReference}
                  />
                )}
              </Suspense>
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md">
            <p className="mb-3 px-1 text-xs font-medium text-muted-foreground">Open beside this thread</p>
            <ItemGroup className="gap-1.5">
              <ToolLaunchItem icon={Activity} label="Running work" onClick={addActivity} />
              <ToolLaunchItem icon={Globe2} label="Browser" onClick={addBrowser} />
              <ToolLaunchItem icon={GitPullRequest} label="Pull request" onClick={addPullRequest} />
              <ToolLaunchItem icon={ChartNoAxesCombined} label="Analytics" onClick={addAnalytics} />
              <ToolLaunchItem icon={Gauge} label="Performance" onClick={addPerformance} />
            </ItemGroup>
          </div>
        </div>
      )}
    </section>
  );
}

function ToolLaunchItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Globe2;
  label: string;
  onClick: () => void;
}) {
  return (
    <Item asChild variant="muted" size="sm" className="rounded-lg hover:bg-accent/70">
      <button type="button" onClick={onClick}>
        <ItemMedia><Icon className="size-4 text-muted-foreground" /></ItemMedia>
        <ItemContent>
          <ItemTitle className="font-normal">{label}</ItemTitle>
        </ItemContent>
      </button>
    </Item>
  );
}

function toolLabel(tab: ThreadToolTab, typeIndex: number): string {
  const label = tab.type === "activity" ? "Running work" : tab.type === "analytics" ? "Analytics" : tab.type === "performance" ? "Performance" : tab.type === "pull-request" ? "Pull request" : "Browser";
  return typeIndex > 0 ? `${label} ${typeIndex + 1}` : label;
}

function toolIcon(type: ThreadToolTab["type"]) {
  if (type === "activity") return Activity;
  if (type === "analytics") return ChartNoAxesCombined;
  if (type === "performance") return Gauge;
  if (type === "pull-request") return GitPullRequest;
  return Globe2;
}
