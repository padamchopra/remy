import type { LinkedTicket } from "@/lib/pull-request-activity-data";
import { cn } from "@/lib/utils";

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
