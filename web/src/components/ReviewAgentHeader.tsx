import { lazy, Suspense, useState, type ReactElement } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover-base";
import { Spinner } from "@/components/ui/spinner";
import { ThreadDot } from "@/components/PullRequestLinkedThread";
import type { ReviewRule } from "@/lib/review-agent";
import type { ReviewTarget } from "@/components/ReviewAgentStart";
import { cn } from "@/lib/utils";

// The popover's computers, models and defaults arrive the first time it opens.
const ReviewAgentStart = lazy(() => import("@/components/ReviewAgentStart").then((module) => ({ default: module.ReviewAgentStart })));

const HEADER_BUTTON = "h-7 gap-[7px] rounded-lg border border-input bg-accent px-2.5 text-xs font-[450] [&_svg]:size-[13px]";

/// The Start review popover, opened from whatever button it wraps: the
/// header's Review with agent, or a stack note's Review #n too.
export function ReviewAgentStartPopover({
  target,
  rules,
  trigger,
  align = "end",
  onViewRules,
  onStarted,
}: {
  target: ReviewTarget;
  rules?: ReviewRule[];
  trigger: ReactElement;
  align?: "start" | "end";
  onViewRules: () => void;
  onStarted: (requestId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align={align}
        sideOffset={8}
        className="flex w-[420px] flex-col gap-3.5 rounded-[14px] border-foreground/10 p-4 shadow-[0_12px_32px_rgb(0_0_0/0.35)] max-sm:w-[var(--available-width)]"
      >
        {open && (
          <Suspense fallback={<div className="flex h-[292px] items-center justify-center"><Spinner className="text-muted-foreground" /></div>}>
            <ReviewAgentStart
              target={target}
              rules={rules}
              onCancel={() => setOpen(false)}
              onViewRules={() => { setOpen(false); onViewRules(); }}
              onStarted={(requestId) => { setOpen(false); onStarted(requestId); }}
            />
          </Suspense>
        )}
      </PopoverContent>
    </Popover>
  );
}

/// The header's review agent control. Before a review it is Review with
/// agent, which opens Start review under it; after, it is Review agent with
/// the review thread's state dot, and shows or hides the pane. Hiding the
/// pane never stops the review.
export function ReviewAgentHeaderButton({
  target,
  reviewing,
  state,
  paneOpen,
  rules,
  onTogglePane,
  onViewRules,
  onStarted,
}: {
  target: ReviewTarget;
  /// A review exists, or one is starting.
  reviewing: boolean;
  state?: unknown;
  paneOpen: boolean;
  rules?: ReviewRule[];
  onTogglePane: () => void;
  onViewRules: () => void;
  onStarted: (requestId: string) => void;
}) {
  if (reviewing) {
    return (
      <Button
        type="button"
        variant="secondary"
        aria-pressed={paneOpen}
        onClick={onTogglePane}
        className={cn(HEADER_BUTTON, paneOpen && "border-foreground/15 bg-foreground/8 dark:bg-foreground/8")}
      >
        <Bot aria-hidden />
        Review agent
        <ThreadDot state={state} />
      </Button>
    );
  }
  return (
    <ReviewAgentStartPopover
      target={target}
      rules={rules}
      onViewRules={onViewRules}
      onStarted={onStarted}
      trigger={(
        <Button type="button" variant="secondary" className={HEADER_BUTTON}>
          <Bot aria-hidden />
          <span className="max-sm:sr-only">Review with agent</span>
        </Button>
      )}
    />
  );
}
