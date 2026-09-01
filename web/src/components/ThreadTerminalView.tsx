import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { RotateCcw, SquareTerminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { transport } from "@/lib/transport";

interface TerminalView {
  terminalId: string;
  active: boolean;
  cwd: string;
  output: string;
  revision: number;
  exitCode?: number;
}

export interface TerminalFrame {
  type?: string;
  terminalId?: string;
  active?: boolean;
  cwd?: string;
  data?: string;
  revision?: number;
  exitCode?: number;
}

/// The renderer itself. `ThreadTerminal` holds it back until the drawer opens,
/// because xterm is the largest thing a thread would otherwise pay for closed.
export function ThreadTerminalView({
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
