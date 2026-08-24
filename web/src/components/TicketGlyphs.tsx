import { Folder } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AgentAvatar as AgentFace } from "@/components/AgentAvatar";
import { UserAvatar } from "@/components/UserAvatar";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { STATUS_LABEL, STATUS_TEXT, WORKSPACE_AGENT, YOU } from "@/lib/tickets";
import { cn } from "@/lib/utils";
import type { Agent, TicketStatus, Workspace } from "@/state/types";

/// The small marks a card is read by.
///
/// Drawn rather than picked from the icon set: each one carries a value — how
/// far through the workflow, how urgent, how much is done — and an icon that
/// only names a state cannot show a quantity. They are the one place in the app
/// where a hand-written SVG beats a primitive.

/// How much of the ring a status fills. Backlog is an outline, Done is whole,
/// and the middle states are the way through — so a column reads as progress
/// even before you get to the words.
const FILLED: Record<TicketStatus, number> = {
  backlog: 0,
  todo: 0,
  in_progress: 0.45,
  needs_input: 0.45,
  pr_review: 0.75,
  done: 1,
  cancelled: 0,
};

export function StatusIcon({
  status,
  className,
  /// Set where the status is already written beside the glyph — a column header,
  /// a menu row. Otherwise the accessible name comes out as "Todo Todo", and a
  /// tooltip fires inside an open menu.
  decorative,
}: {
  status: TicketStatus;
  className?: string;
  decorative?: boolean;
}) {
  const filled = FILLED[status];
  // A quarter-turn back so the arc grows from the top, the way a clock reads.
  const arc = `M 8 8 L 8 2.5 A 5.5 5.5 0 ${filled > 0.5 ? 1 : 0} 1 ${
    8 + 5.5 * Math.sin(filled * Math.PI * 2)
  } ${8 - 5.5 * Math.cos(filled * Math.PI * 2)} Z`;

  const glyph = (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-3.5 shrink-0", STATUS_TEXT[status], className)}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": STATUS_LABEL[status] })}
    >
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={status === "backlog" ? "2.2 2.2" : undefined}
        opacity={status === "cancelled" ? 0.5 : 1}
      />
      {filled > 0 && filled < 1 && <path d={arc} fill="currentColor" />}
      {status === "done" && (
        <path
          d="M 4.8 8.2 L 7 10.4 L 11.2 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {status === "cancelled" && (
        <path
          d="M 5.5 5.5 L 10.5 10.5 M 10.5 5.5 L 5.5 10.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.7"
        />
      )}
    </svg>
  );

  // A glyph that is the only thing saying the status gets a tooltip; one that
  // sits beside the word does not.
  if (decorative) return glyph;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{glyph}</TooltipTrigger>
      <TooltipContent>{STATUS_LABEL[status]}</TooltipContent>
    </Tooltip>
  );
}

/// How much of a ticket's sub-tickets are finished. Only drawn when there are
/// any — an empty ring on every card would be noise.
export function SubTicketProgress({
  done,
  total,
}: {
  done: number;
  total: number;
}) {
  if (total === 0) return null;
  const fraction = done / total;
  const circumference = 2 * Math.PI * 5.5;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            role="img"
            aria-label={`${done} of ${total} done`}
          >
            <circle
              cx="8"
              cy="8"
              r="5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              opacity="0.25"
            />
            <circle
              cx="8"
              cy="8"
              r="5.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray={`${circumference * fraction} ${circumference}`}
              transform="rotate(-90 8 8)"
              className={fraction === 1 ? "text-success" : undefined}
            />
          </svg>
          {done}/{total}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {done} of {total} sub-tickets done
      </TooltipContent>
    </Tooltip>
  );
}

/// An agent's face, on the shared avatar primitive. The mark and tint match the
/// agent roster, so the same person remains recognisable across the app.
/// Whoever has the ticket: you, an agent, or nobody yet.
export function AssigneeAvatar({
  assignee,
  agents,
  workspace,
  workspaceName,
  size = "sm",
  className,
}: {
  assignee?: string;
  agents: Agent[];
  workspace?: Workspace;
  workspaceName?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  if (assignee === YOU) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <UserAvatar className={cn(size === "md" ? "size-6" : "size-5", className)} />
        </TooltipTrigger>
        <TooltipContent>You</TooltipContent>
      </Tooltip>
    );
  }
  // The workspace itself, which is not an agent and so has no colour of its own.
  if (assignee === WORKSPACE_AGENT) {
    const name = workspace?.name ?? workspaceName ?? "Workspace agent";
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Avatar className={cn(size === "md" ? "size-6" : "size-5", className)} aria-label={name}>
            <AvatarFallback className="bg-transparent p-0 text-muted-foreground">
              {workspace ? (
                <WorkspaceMark home={false} workspace={workspace} size="sm" />
              ) : (
                <Folder className={size === "md" ? "size-3.5" : "size-3"} />
              )}
            </AvatarFallback>
          </Avatar>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <AgentFace
      agent={agents.find((entry) => entry.id === assignee)}
      size={size}
      className={className}
    />
  );
}

export { AgentAvatar } from "@/components/AgentAvatar";
