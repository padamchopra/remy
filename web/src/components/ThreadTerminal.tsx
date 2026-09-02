import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { PanelRight } from "lucide-react";
import { usePanelRef } from "react-resizable-panels";
import { SurfaceLoading, useOpenedOnce } from "@/components/Deferred";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type { TerminalFrame } from "@/components/ThreadTerminalView";

const ThreadTerminalView = lazy(() => import("@/components/ThreadTerminalView").then((module) => ({
  default: module.ThreadTerminalView,
})));

const LAYOUT_KEY = "remy.thread-terminal.layout";
const DEFAULT_LAYOUT = { content: 66, terminal: 34 };

function savedLayout(): typeof DEFAULT_LAYOUT {
  try {
    const value = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<typeof DEFAULT_LAYOUT> | null;
    if (!value || typeof value.content !== "number" || typeof value.terminal !== "number") return DEFAULT_LAYOUT;
    return { content: value.content, terminal: value.terminal };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

/// Produces a server-safe terminal key without putting a workspace path into a URL.
export function terminalSessionId(kind: "thread" | "draft", ...parts: string[]): string {
  const safe = parts.join("-").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 140);
  return `${kind}-${safe}`;
}

export function TerminalButton({
  active,
  shown,
  disabled,
  onClick,
}: {
  active: boolean;
  shown: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const label = shown ? "Hide terminal" : "Show terminal";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={shown ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="relative"
        >
          <PanelRight className="rotate-90" />
          {active && <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-emerald-500" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function ThreadTerminalLayout({
  open,
  layoutId,
  children,
  terminal,
}: {
  open: boolean;
  layoutId: string;
  children: ReactNode;
  terminal: ReactNode;
}) {
  const [layout] = useState(savedLayout);
  const terminalSize = useRef(layout.terminal);
  const terminalPanelRef = usePanelRef();

  useEffect(() => {
    const panel = terminalPanelRef.current;
    if (!panel) return;
    if (open) panel.resize(`${terminalSize.current}%`);
    else panel.collapse();
  }, [open, terminalPanelRef]);

  return (
    <ResizablePanelGroup
      id={`thread-terminal-${layoutId}`}
      orientation="vertical"
      defaultLayout={open ? layout : { content: 100, terminal: 0 }}
      className="min-h-0 flex-1 [&>[data-panel]]:transition-[flex-grow] [&>[data-panel]]:duration-200 [&>[data-panel]]:ease-out motion-reduce:[&>[data-panel]]:transition-none"
      onLayoutChanged={(next, meta) => {
        if (meta.isUserInteraction && next.terminal > 0) {
          terminalSize.current = next.terminal;
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
        }
      }}
    >
      <ResizablePanel id="content" minSize="12rem" className="flex min-h-0 min-w-0 overflow-hidden">
        {children}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        aria-label="Resize terminal"
        className={cn(
          "transition-opacity duration-150 motion-reduce:transition-none",
          !open && "pointer-events-none opacity-0",
        )}
      />
      <ResizablePanel
        id="terminal"
        panelRef={terminalPanelRef}
        collapsible
        collapsedSize="0%"
        minSize="10rem"
        maxSize="70%"
        className="flex min-h-0 overflow-hidden"
      >
        <div
          aria-hidden={!open}
          inert={!open}
          className={cn(
            "flex size-full min-h-0 transition-opacity duration-150 motion-reduce:transition-none",
            open ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {terminal}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/// The terminal drawer. Nothing but the frames that keep the header's dot
/// honest runs until the drawer is first opened; after that the session stays
/// mounted, so hiding the drawer leaves the shell and its scrollback alone.
export function ThreadTerminal(props: {
  serverId: string;
  terminalId: string;
  cwd: string;
  label: string;
  visible: boolean;
  onHide: () => void;
  onSessionClosed: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const opened = useOpenedOnce(props.visible);

  if (!opened) {
    return (
      <TerminalPresence
        serverId={props.serverId}
        terminalId={props.terminalId}
        onActiveChange={props.onActiveChange}
      />
    );
  }

  return (
    <Suspense fallback={<SurfaceLoading className="bg-card" />}>
      <ThreadTerminalView {...props} />
    </Suspense>
  );
}

/// A terminal left running on the server outlives the drawer and the page. Watch
/// its frames so the header's dot is right before anybody has opened it here.
function TerminalPresence({
  serverId,
  terminalId,
  onActiveChange,
}: {
  serverId: string;
  terminalId: string;
  onActiveChange?: (active: boolean) => void;
}) {
  const report = useRef(onActiveChange);
  report.current = onActiveChange;

  useEffect(() => transport.subscribe((source, payload) => {
    if (source !== serverId) return;
    const frame = payload as TerminalFrame;
    if (frame.type !== "terminal" || frame.terminalId !== terminalId) return;
    if (typeof frame.active === "boolean") report.current?.(frame.active);
  }, [`terminal:${terminalId}`]), [serverId, terminalId]);

  return null;
}
