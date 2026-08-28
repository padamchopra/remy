import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, ChartNoAxesCombined, Gauge, GitPullRequest, Globe2, Maximize2, Monitor, MousePointer2, PanelRightClose, PanelRightOpen, Plus, RefreshCw, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { ThreadAnalyticsTool, ThreadPerformanceTool } from "@/components/ThreadInsights";
import { PullRequestView } from "@/components/PullRequestView";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type { ChatCodeReference } from "@/state/types";

export interface SharedBrowserView {
  browserId?: string;
  active: boolean;
  url?: string;
  title?: string;
  viewport?: "fullscreen" | "desktop" | "mobile";
  width: number;
  height: number;
  revision: number;
  controller?: "agent" | "you";
  cursor?: { x: number; y: number; pressed?: boolean };
  screenshot?: string;
  error?: string;
}

export interface ThreadToolTab {
  id: string;
  type: "browser" | "analytics" | "performance" | "pull-request";
}

const WIDE_THREAD_TOOLS = "(min-width: 1024px)";

function browserPath(chatId: string, browserId: string, action?: string): string {
  const base = `/chats/${encodeURIComponent(chatId)}/browser${action ? `/${action}` : ""}`;
  return `${base}?instance=${encodeURIComponent(browserId)}`;
}

export function useThreadTools(
  chatId: string,
  serverId: string,
  shown: boolean,
  setShown: (shown: boolean) => void,
  enabled = true,
) {
  const [tabs, setTabs] = useState<ThreadToolTab[]>([]);
  const [activeTab, setActiveTab] = useState("");
  const [views, setViews] = useState<Record<string, SharedBrowserView | undefined>>({});
  const [supportsInstances, setSupportsInstances] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nextBrowser = useRef(2);
  const nextInsight = useRef(2);

  useEffect(() => {
    const media = window.matchMedia(WIDE_THREAD_TOOLS);
    const closeOnNarrow = () => {
      if (!media.matches) setShown(false);
    };
    media.addEventListener("change", closeOnNarrow);
    return () => media.removeEventListener("change", closeOnNarrow);
  }, [setShown]);

  const refresh = useCallback(async (browserId = "default") => {
    if (!enabled) return;
    try {
      const next = await transport.request<SharedBrowserView>(
        serverId,
        browserPath(chatId, browserId),
      );
      if (typeof next.browserId === "string") setSupportsInstances(true);
      setViews((current) => ({ ...current, [browserId]: next }));
    } catch {
      setViews((current) => ({ ...current, [browserId]: undefined }));
    }
  }, [chatId, serverId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    for (const tab of tabs) {
      if (tab.type === "browser") void refresh(tab.id);
    }
  }, [enabled, refresh, tabs]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = transport.subscribe((_source, payload) => {
      const frame = payload as Partial<SharedBrowserView> & { type?: string; chatId?: string; browserId?: string };
      if (frame.type !== "browser" || frame.chatId !== chatId) return;
      if (typeof frame.browserId === "string") setSupportsInstances(true);
      const browserId = frame.browserId || "default";
      setTabs((current) => current.some((tab) => tab.id === browserId) || frame.active === false
        ? current
        : [...current, { id: browserId, type: "browser" }]);
      setViews((current) => ({
        ...current,
        [browserId]: {
          active: frame.active !== false,
          width: current[browserId]?.width ?? 1280,
          height: current[browserId]?.height ?? 800,
          revision: frame.revision ?? current[browserId]?.revision ?? 0,
          ...current[browserId],
          ...frame,
        },
      }));
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void refresh(browserId), 80);
    });
    return () => {
      clearTimeout(refreshTimer.current);
      unsubscribe();
    };
  }, [chatId, enabled, refresh]);

  const addBrowser = () => {
    if (!supportsInstances && tabs.length > 0) return;
    const id = tabs.length === 0
      ? "default"
      : `browser-${Date.now().toString(36)}-${nextBrowser.current++}`;
    setTabs((current) => [...current, { id, type: "browser" }]);
    setActiveTab(id);
    setShown(true);
  };

  const addInsight = (type: "analytics" | "performance") => {
    const id = tabs.some((tab) => tab.type === type)
      ? `${type}-${Date.now().toString(36)}-${nextInsight.current++}`
      : type;
    setTabs((current) => [...current, { id, type }]);
    setActiveTab(id);
    setShown(true);
  };

  const addPullRequest = () => {
    setTabs((current) => current.some((tab) => tab.type === "pull-request") ? current : [...current, { id: "pull-request", type: "pull-request" }]);
    setActiveTab("pull-request");
    setShown(true);
  };

  const closeTab = async (tab: ThreadToolTab) => {
    const browserId = tab.id;
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== browserId);
      if (activeTab === browserId) setActiveTab(next.at(-1)?.id ?? "");
      return next;
    });
    setViews((current) => {
      const next = { ...current };
      delete next[browserId];
      return next;
    });
    if (tab.type !== "browser") return;
    try {
      await transport.request(serverId, browserPath(chatId, browserId, "close"), { method: "POST", body: {} });
    } catch (caught) {
      toast.error("Couldn't close that tool", { description: apiError(caught) });
    }
  };

  return {
    tabs,
    activeTab,
    setActiveTab,
    views,
    setView: (browserId: string, view: SharedBrowserView) =>
      setViews((current) => ({ ...current, [browserId]: view })),
    addBrowser,
    addAnalytics: () => addInsight("analytics"),
    addPerformance: () => addInsight("performance"),
    addPullRequest,
    canAddBrowser: supportsInstances || !tabs.some((tab) => tab.type === "browser"),
    closeTab,
    shown,
    setShown,
    active: Object.values(views).some((view) => view?.active),
  };
}

export function ThreadToolsButton({
  active,
  shown,
  onClick,
}: {
  active: boolean;
  shown: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={shown ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={shown ? "Hide thread tools" : "Show thread tools"}
          onClick={onClick}
          className="relative"
        >
          {shown ? <PanelRightClose /> : <PanelRightOpen />}
          {active && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-emerald-500" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{shown ? "Hide thread tools" : "Show thread tools"}</TooltipContent>
    </Tooltip>
  );
}

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
              ) : (
                <PullRequestView
                  chatId={chatId}
                  serverId={serverId}
                  codeReferences={codeReferences}
                  onAddReference={onAddReference}
                  onRemoveReference={onRemoveReference}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md">
            <p className="mb-3 px-1 text-xs font-medium text-muted-foreground">Open beside this thread</p>
            <ItemGroup className="gap-1.5">
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
  const label = tab.type === "analytics" ? "Analytics" : tab.type === "performance" ? "Performance" : tab.type === "pull-request" ? "Pull request" : "Browser";
  return typeIndex > 0 ? `${label} ${typeIndex + 1}` : label;
}

function toolIcon(type: ThreadToolTab["type"]) {
  if (type === "analytics") return ChartNoAxesCombined;
  if (type === "performance") return Gauge;
  if (type === "pull-request") return GitPullRequest;
  return Globe2;
}

export function SharedBrowser({
  chatId,
  serverId,
  browserId,
  view,
  setView,
}: {
  chatId: string;
  serverId: string;
  browserId: string;
  view?: SharedBrowserView;
  setView: (view: SharedBrowserView) => void;
}) {
  const [address, setAddress] = useState(view?.url ?? "");
  const [busy, setBusy] = useState(false);
  const pageRef = useRef<HTMLButtonElement>(null);
  const keyboardRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (view?.url) setAddress(view.url);
  }, [view?.url]);

  const action = useCallback(async (name: string, body: Record<string, unknown> = {}) => {
    try {
      const next = await transport.request<SharedBrowserView>(
        serverId,
        browserPath(chatId, browserId, name),
        { method: "POST", body },
      );
      if (next && typeof next === "object" && "active" in next) {
        setView(next);
        return next;
      }
    } catch (caught) {
      toast.error("The browser action failed", { description: apiError(caught) });
    }
  }, [browserId, chatId, serverId, setView]);

  const open = async (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim() || busy) return;
    setBusy(true);
    try {
      await action("open", { url: address.trim() });
    } finally {
      setBusy(false);
    }
  };

  const navigate = async (direction: "back" | "forward" | "reload") => {
    if (!view?.active || busy) return;
    setBusy(true);
    try {
      await action(direction);
    } finally {
      setBusy(false);
    }
  };

  const point = (event: MouseEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * (view?.width ?? 1280),
      y: ((event.clientY - bounds.top) / bounds.height) * (view?.height ?? 800),
    };
  };

  const click = (event: MouseEvent<HTMLButtonElement>) => {
    keyboardRef.current?.focus();
    void action("click", point(event));
  };

  const press = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) return;
    event.preventDefault();
    const pieces = [
      event.metaKey ? "Meta" : "",
      event.ctrlKey ? "Control" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
      event.key,
    ].filter(Boolean);
    void action("press", { key: pieces.join("+") });
  };

  const scroll = (event: WheelEvent<HTMLButtonElement>) => {
    event.preventDefault();
    void action("scroll", { deltaX: event.deltaX, deltaY: event.deltaY });
  };

  const scaleX = view?.cursor ? `${(view.cursor.x / (view.width || 1280)) * 100}%` : "0%";
  const scaleY = view?.cursor ? `${(view.cursor.y / (view.height || 800)) * 100}%` : "0%";
  const viewport = view?.viewport ?? (view && view.width < view.height ? "mobile" : "desktop");
  const canChangeViewport = Boolean(view?.active && view.viewport);

  const fullscreenSize = () => {
    const bounds = stageRef.current?.getBoundingClientRect();
    return bounds
      ? { width: Math.round(bounds.width), height: Math.round(bounds.height) }
      : {};
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || viewport !== "fullscreen" || !view?.active) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (!width || !height || (width === view.width && height === view.height)) return;
      clearTimeout(resizeTimer.current);
      resizeTimer.current = setTimeout(() => {
        void action("viewport", { viewport: "fullscreen", width, height });
      }, 120);
    });
    observer.observe(stage);
    return () => {
      clearTimeout(resizeTimer.current);
      observer.disconnect();
    };
  }, [action, view?.active, view?.height, view?.width, viewport]);

  const ViewportIcon = viewport === "fullscreen" ? Maximize2 : viewport === "mobile" ? Smartphone : Monitor;

  return (
    <div className="flex size-full min-h-0 flex-col">
      <form className="flex h-10 shrink-0 items-center gap-1 border-b border-border/70 px-2" onSubmit={(event) => void open(event)}>
        <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="Browser navigation">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" disabled={!view?.active || busy} aria-label="Back" onClick={() => void navigate("back")}>
                <ArrowLeft />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" disabled={!view?.active || busy} aria-label="Forward" onClick={() => void navigate("forward")}>
                <ArrowRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Forward</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" disabled={!view?.active || busy} aria-label="Refresh" onClick={() => void navigate("reload")}>
                <RefreshCw className={cn(busy && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </div>
        <Input
          aria-label="Browser address"
          placeholder="Search or enter URL"
          spellCheck={false}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="h-7 min-w-0 flex-1 border-transparent bg-muted/50 px-2 font-mono text-xs shadow-none focus-visible:border-border focus-visible:ring-0"
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="submit" variant="ghost" size="icon-xs" disabled={!address.trim() || busy} aria-label="Open address">
              <ArrowUpRight />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open address</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-xs" disabled={!canChangeViewport} aria-label="Browser viewport">
                  <ViewportIcon />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Viewport</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={viewport}
              onValueChange={(next) => {
                if (next === "fullscreen") void action("viewport", { viewport: next, ...fullscreenSize() });
                if (next === "desktop" || next === "mobile") void action("viewport", { viewport: next });
              }}
            >
              <DropdownMenuRadioItem value="fullscreen"><Maximize2 />Fit panel</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desktop"><Monitor />Desktop</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="mobile"><Smartphone />Mobile</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </form>

      <div
        ref={stageRef}
        className={cn(
          "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/15",
          viewport === "fullscreen" ? "p-0" : "p-4",
        )}
      >
        {view?.active && view.screenshot ? (
          <div
            className={cn("relative max-h-full max-w-full", viewport === "fullscreen" && "size-full")}
            style={viewport === "fullscreen" ? undefined : {
              aspectRatio: `${view.width} / ${view.height}`,
              ...(view.width < view.height ? { height: "100%" } : { width: "100%" }),
            }}
          >
            <Button
              ref={pageRef}
              type="button"
              variant="ghost"
              className={cn(
                "relative size-full overflow-hidden border border-border/70 bg-white p-0 shadow-sm focus-visible:ring-2",
                viewport === "fullscreen" ? "rounded-none border-0 shadow-none" : "rounded-sm",
              )}
              aria-label="Browser page. Click, scroll, or type to take control."
              onClick={click}
              onWheel={scroll}
            >
              <img src={view.screenshot} alt={view.title || "Shared browser page"} className="size-full object-contain [image-rendering:auto]" draggable={false} />
              {view.cursor && view.controller === "agent" && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute z-10 -translate-x-0.5 -translate-y-0.5 text-blue-500 transition-[left,top] duration-150",
                    view.cursor.pressed && "scale-90",
                  )}
                  style={{ left: scaleX, top: scaleY }}
                >
                  <MousePointer2 className="size-5 fill-blue-500 stroke-white stroke-[1.5] drop-shadow" />
                  {view.cursor.pressed && <span className="absolute left-0 top-0 size-5 animate-ping rounded-full border border-blue-400" />}
                </span>
              )}
            </Button>
            <Input
              ref={keyboardRef}
              tabIndex={-1}
              aria-label="Shared browser keyboard"
              className="pointer-events-none absolute left-0 top-0 size-px border-0 p-0 opacity-0"
              value=""
              onChange={(event) => {
                if (event.target.value) void action("insert", { value: event.target.value });
              }}
              onKeyDown={press}
            />
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Globe2 /></EmptyMedia>
              <EmptyTitle>Open a page to browse together</EmptyTitle>
              <EmptyDescription>You and the agent can click, type, and scroll on the same page.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {view?.active && (
          <span className="pointer-events-none absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur">
            <MousePointer2 className="size-3" />
            {view.controller === "agent" ? "Agent controlling browser" : "You have control"}
          </span>
        )}
      </div>
      {view?.error && <p className="shrink-0 border-t border-border px-3 py-2 text-xs text-destructive">{view.error}</p>}
    </div>
  );
}
