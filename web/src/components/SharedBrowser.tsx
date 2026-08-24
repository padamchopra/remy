import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { ArrowRight, Globe2, LoaderCircle, Monitor, MousePointer2, PanelRightClose, PanelRightOpen, Plus, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";

export interface SharedBrowserView {
  browserId?: string;
  active: boolean;
  url?: string;
  title?: string;
  viewport?: "desktop" | "mobile";
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
  type: "browser";
}

function browserPath(chatId: string, browserId: string, action?: string): string {
  const base = `/chats/${encodeURIComponent(chatId)}/browser${action ? `/${action}` : ""}`;
  return `${base}?instance=${encodeURIComponent(browserId)}`;
}

export function useThreadTools(chatId: string, serverId: string) {
  const [tabs, setTabs] = useState<ThreadToolTab[]>([{ id: "default", type: "browser" }]);
  const [activeTab, setActiveTab] = useState("default");
  const [views, setViews] = useState<Record<string, SharedBrowserView | undefined>>({});
  const [shown, setShown] = useState(false);
  const [supportsInstances, setSupportsInstances] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const nextBrowser = useRef(2);

  const refresh = useCallback(async (browserId = "default") => {
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
  }, [chatId, serverId]);

  useEffect(() => {
    for (const tab of tabs) void refresh(tab.id);
  }, [refresh, tabs]);

  useEffect(() => {
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
  }, [chatId, refresh]);

  const addBrowser = () => {
    if (!supportsInstances && tabs.length > 0) return;
    const id = tabs.length === 0
      ? "default"
      : `browser-${Date.now().toString(36)}-${nextBrowser.current++}`;
    setTabs((current) => [...current, { id, type: "browser" }]);
    setActiveTab(id);
    setShown(true);
  };

  const closeTab = async (browserId: string) => {
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
    canAddTabs: supportsInstances || tabs.length === 0,
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
  canAddTabs,
  closeTab,
}: {
  chatId: string;
  serverId: string;
  tabs: ThreadToolTab[];
  activeTab: string;
  views: Record<string, SharedBrowserView | undefined>;
  setActiveTab: (id: string) => void;
  setView: (id: string, view: SharedBrowserView) => void;
  addBrowser: () => void;
  canAddTabs: boolean;
  closeTab: (id: string) => Promise<void>;
}) {
  return (
    <section aria-label="Thread tools" className="flex size-full min-h-0 flex-col bg-background">
      {tabs.length > 0 ? (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 gap-0">
          <TabsList variant="line" aria-label="Open tools" className="h-10 w-full min-w-0 justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-none border-b border-border px-2 py-0">
            {tabs.map((tab, index) => {
              const label = index === 0 ? "Browser" : `Browser ${index + 1}`;
              return (
                <div key={tab.id} className="flex h-full min-w-0 shrink-0 items-center">
                  <TabsTrigger value={tab.id} className="min-w-0 max-w-36 shrink px-2 after:bottom-0!">
                    <Globe2 />
                    <span className="truncate">{label}</span>
                    {views[tab.id]?.active && <span className="size-1.5 shrink-0 rounded-full bg-success-foreground" />}
                  </TabsTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Close ${label} tab`}
                    onClick={() => void closeTab(tab.id)}
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
                  disabled={!canAddTabs}
                  title={canAddTabs ? undefined : "Restart Remy to add more tool tabs."}
                >
                  <Plus />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={addBrowser}>
                    <Globe2 />
                    Browser
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="min-h-0 overflow-hidden">
              <SharedBrowser
                chatId={chatId}
                serverId={serverId}
                browserId={tab.id}
                view={views[tab.id]}
                setView={(view) => setView(tab.id, view)}
              />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Globe2 /></EmptyMedia>
            <EmptyTitle>No tools open</EmptyTitle>
            <EmptyDescription>Add a tool when you need it beside this thread.</EmptyDescription>
            <Button type="button" size="sm" onClick={addBrowser}>
              <Plus data-icon="inline-start" />
              Add browser
            </Button>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  );
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

  useEffect(() => {
    if (view?.url) setAddress(view.url);
  }, [view?.url]);

  const action = async (name: string, body: Record<string, unknown>) => {
    try {
      const next = await transport.request<SharedBrowserView>(
        serverId,
        browserPath(chatId, browserId, name),
        { method: "POST", body },
      );
      if (next && typeof next === "object" && "active" in next) setView(next);
    } catch (caught) {
      toast.error("The browser action failed", { description: apiError(caught) });
    }
  };

  const open = async (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim() || busy) return;
    setBusy(true);
    await action("open", { url: address.trim() });
    setBusy(false);
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

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{view?.title || "Browser session"}</p>
        <ToggleGroup
          type="single"
          value={viewport}
          variant="outline"
          size="sm"
          aria-label="Browser viewport"
          disabled={!canChangeViewport}
          onValueChange={(next) => {
            if (next === "desktop" || next === "mobile") void action("viewport", { viewport: next });
          }}
        >
          <ToggleGroupItem value="desktop" aria-label="Desktop viewport" title="Desktop viewport" className="px-2">
            <Monitor />
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" aria-label="Mobile viewport" title="Mobile viewport" className="px-2">
            <Smartphone />
          </ToggleGroupItem>
        </ToggleGroup>
        {view?.active && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MousePointer2 className="size-3" />
            {view.controller === "agent" ? "Agent controlling" : "You have control"}
          </span>
        )}
      </div>

      <form className="flex shrink-0 items-center gap-2 border-b border-border p-2" onSubmit={(event) => void open(event)}>
        <Input
          aria-label="Browser address"
          placeholder="http://127.0.0.1:5173"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="h-8 font-mono text-xs"
        />
        <Button type="submit" size="icon-sm" disabled={!address.trim() || busy} aria-label="Open address">
          {busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
        </Button>
      </form>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/20 p-3">
        {view?.active && view.screenshot ? (
          <div
            className="relative max-h-full max-w-full"
            style={{
              aspectRatio: `${view.width} / ${view.height}`,
              ...(view.width < view.height ? { height: "100%" } : { width: "100%" }),
            }}
          >
            <Button
              ref={pageRef}
              type="button"
              variant="ghost"
              className="relative size-full overflow-hidden rounded-md border border-border bg-white p-0 shadow-sm focus-visible:ring-2"
              aria-label="Browser page. Click, scroll, or type to take control."
              onClick={click}
              onWheel={scroll}
            >
              <img src={view.screenshot} alt={view.title || "Shared browser page"} className="size-full object-contain" draggable={false} />
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
      </div>
      {view?.error && <p className="shrink-0 border-t border-border px-3 py-2 text-xs text-destructive">{view.error}</p>}
    </div>
  );
}
