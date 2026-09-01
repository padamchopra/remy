export const THREAD_TICKET_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "needs_input",
  "pr_review",
  "done",
  "cancelled",
] as const;

const STATUS_LANGUAGE: Record<(typeof THREAD_TICKET_STATUSES)[number], RegExp> = {
  backlog: /\bbacklog\b/i,
  todo: /\b(?:todo|to do)\b/i,
  in_progress: /\b(?:in progress|start(?:ed)?|pick(?:ed)? up)\b/i,
  needs_input: /\b(?:needs? input|blocked|waiting for (?:my|user) input)\b/i,
  pr_review: /\b(?:pr review|pull request review|ready for review)\b/i,
  done: /\b(?:done|complete|completed|close|closed)\b/i,
  cancelled: /\b(?:cancel|canceled|cancelled)\b/i,
};

const STATUS_ACTION = /\b(?:mark|move|set|change|update|put|send|take|start|cancel|close|complete)\b/i;
const NEGATED_STATUS_ACTION = /\b(?:do not|don't|dont|never|should not|shouldn't)\b[^.!?]{0,80}\b(?:mark|move|set|change|update|put|send|take|start|cancel|close|complete)\b/i;

export function explicitlyRequestedTicketStatus(
  message: unknown,
  instruction: unknown,
  status: unknown,
): boolean {
  if (typeof message !== "string" || typeof instruction !== "string" || typeof status !== "string") return false;
  if (!THREAD_TICKET_STATUSES.includes(status as (typeof THREAD_TICKET_STATUSES)[number])) return false;
  const quote = instruction.trim();
  if (!quote || !message.includes(quote) || NEGATED_STATUS_ACTION.test(quote)) return false;
  return STATUS_ACTION.test(quote) && STATUS_LANGUAGE[status as (typeof THREAD_TICKET_STATUSES)[number]].test(quote);
}

export const REMY_TOOL_INSTRUCTIONS = `Use Remy as the source of truth for the user's workspaces, threads, agents, tickets, routines, and durable agent memories. A project or repository the user wants registered is a Remy workspace. When the user names a ticket key, read it before planning or changing code; a linked thread may omit the key. Use the thread tools when the user asks you to delegate, start another thread, continue one, or inspect its result. When work already has a thread, message that thread rather than starting another; list_threads shows each thread's ticket key. Name an agent whenever you do start one, because a thread with no agent carries no directives. In an agent's Inbox conversation, create a routine when the person asks for work to happen repeatedly, routinely, or on a cadence; preserve the complete instruction they want the agent to receive each time. Save a memory only for a durable fact or preference that should change future work; never save credentials, environment values, private tool output, or a routine turn summary. Use the shared browser for click and visual QA so the person can watch and take control, and check both desktop and mobile layouts when the interface is responsive. Use run_with_environment when a command needs the workspace's configured environment; never try to read or print those values. Keep product scope and findings on the ticket. Ticket status normally follows thread activity; change it only when the person explicitly asks for a particular status. Never infer Done from finishing your work. Do not claim Remy changed unless a tool confirms it.`;
