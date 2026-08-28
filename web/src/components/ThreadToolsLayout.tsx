import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePanelRef } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";

const WIDE_TOOLS = "(min-width: 1024px)";
const LAYOUT_KEY = "remy.thread-tools.layout";
const DEFAULT_LAYOUT = { thread: 50, tools: 50 };

function useWideTools(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(WIDE_TOOLS).matches);

  useEffect(() => {
    const media = window.matchMedia(WIDE_TOOLS);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);

  return wide;
}

function savedLayout(): typeof DEFAULT_LAYOUT {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_LAYOUT;
    const value = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<typeof DEFAULT_LAYOUT> | null;
    if (!value || typeof value.thread !== "number" || typeof value.tools !== "number") return DEFAULT_LAYOUT;
    return { thread: value.thread, tools: value.tools };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function ThreadToolsLayout({
  open,
  threadId,
  children,
  sidebar,
}: {
  open: boolean;
  threadId: string;
  children: ReactNode;
  sidebar: ReactNode;
}) {
  const wide = useWideTools();
  const [layout] = useState(savedLayout);
  const toolsSize = useRef(layout.tools);
  const toolsPanelRef = usePanelRef();

  useEffect(() => {
    if (!wide) return;
    const panel = toolsPanelRef.current;
    if (!panel) return;
    if (open) panel.resize(`${toolsSize.current}%`);
    else panel.collapse();
  }, [open, toolsPanelRef, wide]);

  if (!wide) {
    return (
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {children}
        <div
          aria-hidden={!open}
          inert={!open}
          className={cn(
            "absolute inset-0 z-20 bg-background shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none",
            open ? "translate-x-0" : "pointer-events-none translate-x-full",
          )}
        >
          {sidebar}
        </div>
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      id={`thread-tools-${threadId}`}
      orientation="horizontal"
      defaultLayout={open ? layout : { thread: 100, tools: 0 }}
      className="min-h-0 flex-1 [&>[data-panel]]:transition-[flex-grow] [&>[data-panel]]:duration-200 [&>[data-panel]]:ease-out motion-reduce:[&>[data-panel]]:transition-none"
      onLayoutChanged={(next, meta) => {
        if (meta.isUserInteraction && next.tools > 0) {
          toolsSize.current = next.tools;
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
        }
      }}
    >
      <ResizablePanel id="thread" minSize="20rem" className="flex min-h-0 min-w-0 overflow-hidden">
        {children}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        aria-label="Resize thread tools"
        className={cn(
          "transition-opacity duration-150 motion-reduce:transition-none",
          !open && "pointer-events-none opacity-0",
        )}
      />
      <ResizablePanel
        id="tools"
        panelRef={toolsPanelRef}
        collapsible
        collapsedSize="0%"
        minSize="20rem"
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
          {sidebar}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
