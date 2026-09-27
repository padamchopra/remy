import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import type { HubThread } from "@remy/contract";
import { Switch } from "@/components/ui/switch-base";
import { apiError } from "@/lib/api-error";
import type { LinkedTicket, PullRequestFollowState } from "@/lib/pull-request-activity-data";
import { cn } from "@/lib/utils";

/// The Summary rail's Watched by, shown only with a linked thread: that
/// thread, and a switch that sends what reviewers write on GitHub to it.
export function WatchedBy({ thread, state, failed, onChange, onOpenThread }: {
  thread: HubThread;
  state?: PullRequestFollowState;
  failed: boolean;
  onChange: (thread: HubThread | null) => Promise<unknown>;
  onOpenThread: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<boolean>();
  const watching = state?.follow?.threadId === thread.id && state.follow.computerId === thread.computerId;
  const checked = optimistic ?? watching;
  const title = thread.detail.title || "Untitled thread";
  const detail = failed
    ? "Watching is unavailable right now."
    : state && !state.receives
      ? "Needs the Remy GitHub app on this repository."
      : state?.follow && !watching
        ? "Another thread watches it now."
        : "Answers review comments here";
  const toggle = async (next: boolean) => {
    setBusy(true);
    setOptimistic(next);
    try {
      await onChange(next ? thread : null);
    } catch (caught) {
      toast.error(next ? "Couldn't start watching" : "Couldn't stop watching", { description: apiError(caught) });
    } finally {
      setOptimistic(undefined);
      setBusy(false);
    }
  };
  return (
    <section aria-label="Watched by" data-slot="pull-request-watched-by" className="flex shrink-0 flex-col gap-[9px] px-0.5">
      <h2 className="text-[11px] leading-4 font-semibold tracking-[0.025em] text-muted-foreground uppercase">Watched by</h2>
      <div className="flex min-w-0 items-start gap-[9px]">
        <MessagesSquare aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            data-link
            onClick={onOpenThread}
            className="min-w-0 truncate rounded-sm text-left text-xs leading-[18px] text-foreground outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {title}
          </button>
          <span className="text-[11px] leading-4 text-muted-foreground">{detail}</span>
        </div>
        {!failed && (
          <Switch
            size="sm"
            aria-label={`Send review comments to ${title}`}
            checked={checked}
            disabled={busy || !state || !state.receives}
            onCheckedChange={(next) => void toggle(next)}
            className="mt-0.5"
          />
        )}
      </div>
    </section>
  );
}

const TICKET_DOT: Record<LinkedTicket["state"], string> = {
  started: "bg-info-foreground",
  completed: "bg-success-foreground",
  canceled: "bg-muted-foreground/40",
  unstarted: "bg-muted-foreground/60",
  backlog: "bg-muted-foreground/60",
  triage: "bg-warning-foreground",
  "": "bg-muted-foreground/60",
};

/// The Linear issue this pull request belongs to, as Paper 4AN-0 draws it:
/// state dot, identifier, title. It opens the issue in Linear.
export function LinkedTicketChip({ ticket }: { ticket: LinkedTicket }) {
  const body = (
    <>
      <span aria-hidden className={cn("size-[5px] shrink-0 rounded-full", TICKET_DOT[ticket.state])} />
      <span className="shrink-0 font-mono text-[11px] leading-[14px] text-foreground">{ticket.identifier}</span>
      <span className="min-w-0 truncate text-[11px] leading-[14px] text-muted-foreground">{ticket.title}</span>
    </>
  );
  const chip = "inline-flex h-[22px] max-w-full min-w-0 items-center gap-1.5 self-start rounded-[6px] border border-input px-2";
  return ticket.url ? (
    <a data-slot="pull-request-ticket" href={ticket.url} target="_blank" rel="noreferrer" data-link className={cn(chip, "outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50")}>
      {body}
    </a>
  ) : (
    <span data-slot="pull-request-ticket" className={chip}>{body}</span>
  );
}
