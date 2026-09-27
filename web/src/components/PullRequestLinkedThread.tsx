import { MessagesSquare } from "lucide-react";
import type { HubThread } from "@remy/contract";
import { linkedThreadTone } from "@/lib/pull-request-linked-thread";
import { cn } from "@/lib/utils";

/// A linked thread's state dot: blue while it works, amber when it needs you,
/// grey otherwise.
export function ThreadDot({ state, className }: { state: unknown; className?: string }) {
  const tone = linkedThreadTone(state);
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "working" ? "bg-info-foreground" : tone === "needs_input" ? "bg-warning-foreground" : "bg-muted-foreground/60",
        className,
      )}
    />
  );
}

const THREAD_STATE: Record<ReturnType<typeof linkedThreadTone>, string> = {
  working: "working",
  needs_input: "needs you",
  done: "done",
};

/// A linked thread, drawn the same way everywhere: thread icon, title cut off
/// with an ellipsis, and its state dot. It opens the thread. `compact` is the
/// chip in a comment box's footer.
export function LinkedThreadChip({ thread, onOpen, compact, className }: {
  thread: HubThread;
  onOpen: () => void;
  compact?: boolean;
  className?: string;
}) {
  const title = thread.detail.title || "Untitled thread";
  return (
    <button
      type="button"
      data-link
      data-slot="linked-thread"
      onClick={onOpen}
      aria-label={`${title}, ${THREAD_STATE[linkedThreadTone(thread.detail.state)]}`}
      className={cn(
        "flex min-w-0 items-center border border-border text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
        compact
          ? "h-7 max-w-[300px] gap-[7px] rounded-lg border-input pr-2.5 pl-[9px] text-[11px] leading-4 text-foreground/70"
          : "h-7 gap-2 rounded-lg px-2.5 text-xs",
        className,
      )}
    >
      <MessagesSquare aria-hidden className={cn("shrink-0 text-muted-foreground", compact ? "size-[13px]" : "size-3.5")} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <ThreadDot state={thread.detail.state} />
    </button>
  );
}
