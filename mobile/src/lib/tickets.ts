import type { Ticket, TicketStatus } from "../state/types";

/// The board's vocabulary, kept the same as `web/src/lib/tickets.ts` so a
/// ticket reads the same on the phone as in the window.

export const TICKET_STATUSES: TicketStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "needs_input",
  "pr_review",
  "done",
  "cancelled",
];

/// Remy sets these two by watching the thread. Everything else is yours, or
/// something an agent declared on purpose.
export const DERIVED_STATUSES: TicketStatus[] = ["in_progress", "needs_input"];

/// Cancelled is a status you can set but not a column anyone wants standing in
/// front of them all day.
export const BOARD_COLUMNS: TicketStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "needs_input",
  "pr_review",
  "done",
];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  needs_input: "Needs input",
  pr_review: "PR Review",
  done: "Done",
  cancelled: "Cancelled",
};

/// Ranks sort as plain strings, which is the whole point of them.
export function byRank(a: Ticket, b: Ticket): number {
  return a.rank.localeCompare(b.rank) || a.createdAt - b.createdAt;
}

/// A board only shows tickets that are not part of another one — a sub-ticket
/// belongs on its parent, where its progress is already counted.
export function topLevel(tickets: Ticket[]): Ticket[] {
  return tickets.filter((ticket) => !ticket.parentId);
}

/// How far through its sub-tickets a ticket is. Cancelled ones are not work
/// anybody still owes, so they count as settled.
export function subTicketProgress(tickets: Ticket[], ticket: Ticket): { done: number; total: number } {
  const children = tickets.filter((entry) => entry.parentId === ticket.id);
  const done = children.filter((entry) => entry.status === "done" || entry.status === "cancelled").length;
  return { done, total: children.length };
}
