import { lazy, Suspense, useEffect, useRef } from "react";
import { SurfaceLoading, useOpenedOnce } from "@/components/Deferred";
import { transport } from "@/lib/transport";
import type { TerminalFrame } from "@/components/ThreadTerminalView";

const ThreadTerminalView = lazy(() => import("@/components/ThreadTerminalView").then((module) => ({
  default: module.ThreadTerminalView,
})));

/// Produces a server-safe terminal key without putting a workspace path into a URL.
export function terminalSessionId(kind: "thread" | "draft", ...parts: string[]): string {
  const safe = parts.join("-").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 140);
  return `${kind}-${safe}`;
}

/// A terminal tab. Nothing but the frames that keep the tab's dot honest runs
/// until the tab is first brought forward; after that the session stays
/// mounted, so another tab in front leaves the shell and its scrollback alone.
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

/// A terminal left running on the server outlives the tab and the page. Watch
/// its frames so the tab's dot is right before anybody has opened it here.
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
