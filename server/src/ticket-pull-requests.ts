import { basename, dirname } from "node:path";
import { deviceId } from "./board-log.js";
import { projectForWorkspace } from "./projects.js";
import {
  listAuthoredPullRequests,
  listMergedPullRequests,
  type AuthoredPullRequest,
  type MergedPullRequest,
} from "./pull-requests.js";
import { listTickets, syncTicketFromPullRequest, type TicketStatus, type TicketView } from "./tickets.js";
import { listWorkspaces } from "./workspaces.js";

/// What a ticket's pull request does to its status.
///
/// `tickets.ts` owns the rule — which columns a ready or merged pull request may
/// move — and this owns finding the pull request that belongs to a ticket. Only
/// the machine holding the repository can ask GitHub, so only it sweeps; the
/// status event it writes reaches every paired machine through the board log.

const SWEEP_INTERVAL_MS = 60_000;

/// A ticket whose pull request has not landed yet is worth asking about. Done
/// and Cancelled are answers already given.
const OPEN: TicketStatus[] = ["backlog", "todo", "in_progress", "needs_input", "pr_review"];

/// The ticket a Remy worktree was checked out for, from its path. Every one of
/// them is `<...>/.remy/tickets/<key>` — see `checkoutTicketWorktree` — so the
/// path names its ticket without a lookup.
export function ticketKeyFromWorktree(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const trimmed = path.replace(/\/+$/, "");
  if (basename(dirname(trimmed)) !== "tickets") return undefined;
  const key = basename(trimmed).toUpperCase();
  return /^[A-Z0-9]+-[1-9]\d*$/.test(key) ? key : undefined;
}

function mentionsKey(text: string, key: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${key}(?![0-9])`, "i").test(text);
}

/// The ticket a pull request is the work for, out of the tickets on its board.
///
/// Three signals, strongest first: the worktree Remy checked the branch out
/// into names its ticket; the ticket already records the branch; or the pull
/// request names the ticket's key in its branch or title. Anything vaguer would
/// close the wrong card.
export function ticketForPullRequest(
  pullRequest: { headRefName: string; title: string; worktreePath?: string | null },
  tickets: TicketView[],
): TicketView | undefined {
  const fromWorktree = ticketKeyFromWorktree(pullRequest.worktreePath);
  if (fromWorktree) {
    const named = tickets.find((ticket) => ticket.key === fromWorktree);
    if (named) return named;
  }
  const branch = pullRequest.headRefName.trim();
  if (branch) {
    const recorded = tickets.find((ticket) => ticket.branch === branch);
    if (recorded) return recorded;
  }
  return tickets.find((ticket) =>
    (branch && mentionsKey(branch, ticket.key)) || mentionsKey(pullRequest.title, ticket.key)
  );
}

/// One pass over what GitHub says about this machine's tickets.
///
/// Open pull requests come from the cache the pull request pane and monitor
/// already fill. Merged ones are asked for per workspace, and only when that
/// workspace still holds a ticket that could be closed by one.
export async function syncTicketsFromPullRequests(): Promise<void> {
  const open = await listAuthoredPullRequests();
  const claimed = new Set<string>();
  for (const pullRequest of open) {
    const ticket = ticketForPullRequest(pullRequest, candidates(pullRequest.workspaceId));
    if (!ticket) continue;
    claimed.add(ticket.id);
    syncTicketFromPullRequest(ticket.id, pullRequest.isDraft ? "draft" : "ready", {
      branch: pullRequest.headRefName,
      note: readyNote(pullRequest),
    });
  }

  for (const workspace of await listWorkspaces()) {
    const waiting = candidates(workspace.id).filter((ticket) => !claimed.has(ticket.id));
    if (waiting.length === 0) continue;
    const merged = await listMergedPullRequests(workspace);
    for (const pullRequest of merged) {
      const ticket = ticketForPullRequest(pullRequest, waiting);
      if (!ticket) continue;
      syncTicketFromPullRequest(ticket.id, "merged", {
        branch: pullRequest.headRefName,
        note: mergedNote(pullRequest),
      });
    }
  }
}

function readyNote(pullRequest: AuthoredPullRequest): string {
  return `${pullRequest.repository}#${pullRequest.number} is ready for review.`;
}

function mergedNote(pullRequest: MergedPullRequest): string {
  return `${pullRequest.repository}#${pullRequest.number} is merged.`;
}

/// The tickets a workspace's pull requests could still move: this machine's
/// own, on the board that workspace holds.
function candidates(workspaceId: string): TicketView[] {
  const project = projectForWorkspace(workspaceId);
  if (!project) return [];
  return listTickets(project.id).filter(
    (ticket) => OPEN.includes(ticket.status) && (!ticket.deviceId || ticket.deviceId === deviceId),
  );
}

export function startTicketPullRequestSync(): void {
  const sweep = () => void syncTicketsFromPullRequests().catch((error) => {
    console.error("ticket pull request sync failed:", error);
  });
  setTimeout(sweep, 15_000).unref();
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
}
