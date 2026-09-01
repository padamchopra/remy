import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Globe2, Maximize2, Monitor, MousePointer2, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type { SharedBrowserView } from "@/hooks/use-thread-tools";

function browserPath(chatId: string, browserId: string, action?: string): string {
  const base = `/chats/${encodeURIComponent(chatId)}/browser${action ? `/${action}` : ""}`;
  return `${base}?instance=${encodeURIComponent(browserId)}`;
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
