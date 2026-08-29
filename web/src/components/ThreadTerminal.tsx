import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { PanelRight, RotateCcw, SquareTerminal, X } from "lucide-react";
import { usePanelRef } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";

interface TerminalView {
  terminalId: string;
  active: boolean;
  cwd: string;
  output: string;
  revision: number;
  exitCode?: number;
}

interface TerminalFrame {
  type?: string;
  terminalId?: string;
  active?: boolean;
  cwd?: string;
  data?: string;
  revision?: number;
  exitCode?: number;
}

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

export function ThreadTerminal({
  serverId,
  terminalId,
  cwd,
  label,
  visible,
  onHide,
  onSessionClosed,
  onActiveChange,
}: {
  serverId: string;
  terminalId: string;
  cwd: string;
  label: string;
  visible: boolean;
  onHide: () => void;
  onSessionClosed: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();
  const restartRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => onActiveChange?.(active), [active, onActiveChange]);
  useEffect(() => setActive(false), [serverId, terminalId]);

  // The process keeps running while the drawer is hidden. Keep its small
  // status dot honest without keeping an xterm renderer alive off-screen.
  useEffect(() => transport.subscribe((source, payload) => {
    if (source !== serverId) return;
    const frame = payload as TerminalFrame;
    if (frame.type !== "terminal" || frame.terminalId !== terminalId) return;
    if (typeof frame.active === "boolean") setActive(frame.active);
  }), [serverId, terminalId]);

  useEffect(() => {
    if (!visible || !hostRef.current) return;
    let disposed = false;
    let revision = -1;
    let opened = false;
    let missedInitialFrame = false;
    let input = "";
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let refresh: Promise<void> | undefined;
    const fit = new FitAddon();
    const terminalBackground = getComputedStyle(hostRef.current).backgroundColor;
    const terminal = new XTerm({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: {
        background: terminalBackground,
        foreground: "#d4d4d8",
        cursor: "#d4d4d8",
        selectionBackground: "#3f3f4680",
        scrollbarSliderBackground: "#00000000",
        scrollbarSliderHoverBackground: "#00000000",
        scrollbarSliderActiveBackground: "#00000000",
      },
    });
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);

    const apply = (next: TerminalView) => {
      if (disposed) return;
      revision = next.revision;
      terminal.reset();
      if (next.output) terminal.write(next.output);
      setActive(next.active);
      setError(undefined);
      requestAnimationFrame(() => {
        if (disposed) return;
        fit.fit();
        terminal.focus();
      });
    };

    const open = async () => {
      if (disposed) return;
      setOpening(true);
      try {
        fit.fit();
        const next = await transport.request<TerminalView>(
          serverId,
          `/terminals/${encodeURIComponent(terminalId)}/open`,
          { method: "POST", body: { cwd, cols: terminal.cols, rows: terminal.rows } },
        );
        apply(next);
        opened = true;
        if (missedInitialFrame) {
          missedInitialFrame = false;
          queueMicrotask(refreshSnapshot);
        }
      } catch (caught) {
        if (!disposed) {
          setActive(false);
          setError(caught instanceof Error ? caught.message : "Couldn't open the terminal.");
        }
      } finally {
        if (!disposed) setOpening(false);
      }
    };
    restartRef.current = () => void open();

    const refreshSnapshot = () => {
      refresh ??= open().finally(() => {
        refresh = undefined;
      });
    };
    const unsubscribe = transport.subscribe((source, payload) => {
      if (source !== serverId) return;
      const frame = payload as TerminalFrame;
      if (frame.type !== "terminal" || frame.terminalId !== terminalId) return;
      if (!opened) {
        missedInitialFrame = true;
        return;
      }
      if (typeof frame.revision !== "number" || frame.revision !== revision + 1) {
        refreshSnapshot();
        return;
      }
      revision = frame.revision;
      if (frame.data) terminal.write(frame.data);
      if (typeof frame.active === "boolean") setActive(frame.active);
    });

    const flushInput = () => {
      inputTimer = undefined;
      const data = input;
      input = "";
      if (!data) return;
      void transport.request(
        serverId,
        `/terminals/${encodeURIComponent(terminalId)}/write`,
        { method: "POST", body: { data } },
      ).catch((caught) => {
        if (!disposed) setError(caught instanceof Error ? caught.message : "Couldn't write to the terminal.");
      });
    };
    const inputDisposable = terminal.onData((data) => {
      input += data;
      if (!inputTimer) inputTimer = setTimeout(flushInput, 16);
    });
    const resize = () => {
      if (disposed || !opened) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed) return;
        void transport.request(
          serverId,
          `/terminals/${encodeURIComponent(terminalId)}/resize`,
          { method: "POST", body: { cols: terminal.cols, rows: terminal.rows } },
        ).catch(() => undefined);
      }, 80);
    };
    const observer = new ResizeObserver(() => {
      if (disposed) return;
      requestAnimationFrame(() => {
        if (disposed || !hostRef.current?.clientWidth || !hostRef.current.clientHeight) return;
        fit.fit();
        resize();
      });
    });
    observer.observe(hostRef.current);
    void open();

    return () => {
      disposed = true;
      restartRef.current = undefined;
      if (inputTimer) {
        clearTimeout(inputTimer);
        flushInput();
      }
      clearTimeout(resizeTimer);
      observer.disconnect();
      inputDisposable.dispose();
      unsubscribe();
      terminal.dispose();
    };
  }, [cwd, serverId, terminalId, visible]);

  const close = useCallback(async () => {
    try {
      await transport.request(serverId, `/terminals/${encodeURIComponent(terminalId)}/close`, { method: "POST" });
      setActive(false);
      setError(undefined);
      onSessionClosed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't close the terminal.");
    }
  }, [onSessionClosed, serverId, terminalId]);

  const sessionAction = active ? "Close terminal session" : "Restart terminal";

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-card" aria-label="Terminal">
      <div className="flex h-8 shrink-0 items-center border-b bg-muted/20 text-xs">
        <div className="flex h-full min-w-0 max-w-56 items-center gap-1 border-r bg-card pl-2 pr-1">
          <SquareTerminal className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium" title={label}>{label}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={sessionAction}
                disabled={opening}
                onClick={() => active ? void close() : restartRef.current?.()}
              >
                {active ? <X /> : <RotateCcw />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sessionAction}</TooltipContent>
          </Tooltip>
        </div>
        {error && <span className="min-w-0 flex-1 truncate px-2 text-destructive" title={error}>{error}</span>}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto mr-1"
              aria-label="Hide terminal"
              onClick={onHide}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Hide terminal</TooltipContent>
        </Tooltip>
      </div>
      <div
        ref={hostRef}
        className="min-h-0 min-w-0 flex-1 overflow-hidden bg-card px-2 py-1.5 [&_.xterm]:h-full"
      />
    </section>
  );
}
