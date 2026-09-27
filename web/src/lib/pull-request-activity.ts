import { linkedThreadTone } from "./pull-request-linked-thread";

/// What `github/pull-request-activity` answers: GitHub's timeline for one
/// pull request, what was sent to the thread watching it, and when you last
/// opened its Activity.
export interface ActivityAuthor {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface ActivityFromThread {
  computerId: string;
  threadId: string;
  computerName: string | null;
}

export type ActivityItem =
  | { kind: "comment"; id: string; at: string; author: ActivityAuthor; body: string; url: string | null; thread: ActivityFromThread | null }
  | {
    kind: "review";
    id: string;
    at: string;
    author: ActivityAuthor;
    state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
    body: string;
    comments: number;
    url: string | null;
    thread: ActivityFromThread | null;
  }
  | { kind: "checks"; id: string; at: string; commit: string; state: "pass" | "fail"; failed: string[]; total: number };

export interface ActivityDelivery {
  id: string;
  at: string;
  summary: string;
  threadId: string;
  computerId: string;
}

export interface PullRequestActivity {
  userId: string;
  viewer: string;
  viewerAuthor?: ActivityAuthor;
  seenAt: number | null;
  items: ActivityItem[];
  deliveries: ActivityDelivery[];
}

/// The parts of a hub thread a thread event reads.
export interface ActivityThread {
  id: string;
  computerId: string;
  observedAt: number;
  access: { owner: { id: string; label: string } };
  detail: { state?: unknown; updatedAt?: unknown; title?: string } & Record<string, unknown>;
}

export type ActivityEntry<T extends ActivityThread = ActivityThread> =
  | ActivityItem
  | { kind: "thread"; id: string; at: string; text: string; thread: T };

function whose(thread: ActivityThread, userId: string) {
  return thread.access.owner.id === userId ? "Your thread" : `${thread.access.owner.label}'s thread`;
}

/// A thread event says what a Remy thread did about this pull request, from
/// what Remy actually knows: what the hub sent to the thread watching it,
/// and what the linked thread is doing now. Nothing is inferred beyond that.
export function threadEvents<T extends ActivityThread>(
  activity: Pick<PullRequestActivity, "deliveries" | "userId">,
  threads: readonly T[],
  linked: T | undefined,
): ActivityEntry<T>[] {
  const events: ActivityEntry<T>[] = [];
  for (const delivery of activity.deliveries) {
    const thread = threads.find((entry) => entry.id === delivery.threadId && entry.computerId === delivery.computerId);
    if (!thread) continue;
    events.push({ kind: "thread", id: `delivery:${delivery.id}`, at: delivery.at, text: `Sent ${delivery.summary} to ${whose(thread, activity.userId).replace(/^Your/, "your")}`, thread });
  }
  if (linked) {
    const tone = linkedThreadTone(linked.detail.state);
    const at = typeof linked.detail.updatedAt === "number" ? linked.detail.updatedAt : linked.observedAt;
    if (tone !== "done" && Number.isFinite(at)) {
      events.push({
        kind: "thread",
        id: `thread:${linked.id}`,
        at: new Date(at).toISOString(),
        text: tone === "working" ? `${whose(linked, activity.userId)} is working on this branch` : `${whose(linked, activity.userId)} needs you`,
        thread: linked,
      });
    }
  }
  return events;
}

/// One timeline, oldest first, as Paper draws it: newest last, beside the composer.
export function activityTimeline<T extends ActivityThread>(
  activity: PullRequestActivity | undefined,
  threads: readonly T[],
  linked: T | undefined,
): ActivityEntry<T>[] {
  if (!activity) return [];
  return [...activity.items, ...threadEvents(activity, threads, linked)]
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

/// The Activity tab's badge: reviews, comments and check results that arrived
/// since you last opened it, leaving out your own. A thread event mirrors one
/// of those or is live status, so it never adds to the count. Before the first
/// read of a pull request there is no mark, and nothing is new.
export function unseenActivity(activity: PullRequestActivity | undefined): number {
  if (!activity || activity.seenAt === null) return 0;
  const viewer = activity.viewer.toLowerCase();
  return activity.items.filter((item) => {
    if (Date.parse(item.at) <= activity.seenAt!) return false;
    if (item.kind !== "checks" && viewer && item.author.login.toLowerCase() === viewer) return false;
    return true;
  }).length;
}

export function authorName(author: ActivityAuthor) {
  return author.name || author.login;
}

/// "Dee Rahman approved these changes", or for a review that only left line
/// comments, "Sam Keane left 3 comments on lines".
export function reviewSentence(item: Extract<ActivityItem, { kind: "review" }>) {
  const name = authorName(item.author);
  if (item.state === "APPROVED") return `${name} approved these changes`;
  if (item.state === "CHANGES_REQUESTED") return `${name} requested changes`;
  if (item.state === "DISMISSED") return `${name}'s review was dismissed`;
  if (!item.body.trim() && item.comments) return `${name} left ${item.comments === 1 ? "a comment" : `${item.comments} comments`} on lines`;
  return `${name} reviewed`;
}

function names(list: string[]) {
  if (list.length <= 1) return list[0] ?? "";
  if (list.length <= 3) return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  return `${list.slice(0, 2).join(", ")} and ${list.length - 2} more`;
}

/// "typecheck and server tests failed on 3e91f2a", or "Checks passed on 3e91f2a".
export function checksSentence(item: Extract<ActivityItem, { kind: "checks" }>) {
  if (item.state === "fail") {
    const failed = item.failed.length ? item.failed : ["A check"];
    return `${names(failed)} failed on ${item.commit}`;
  }
  return `${item.total === 1 ? "The check" : `All ${item.total} checks`} passed on ${item.commit}`;
}

/// Short relative time, as the timeline shows it: now, 11m, 2h, 3d, then the date.
export function shortAgo(value: string, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(new Date(at).getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }) });
}

/// "From a thread on MacBook Pro", or without the computer once it is gone.
export function fromThreadLabel(from: ActivityFromThread) {
  return from.computerName ? `From a thread on ${from.computerName}` : "From a thread";
}

/// What Send to thread delivers from the Activity composer: your words, with
/// the pull request they are about.
export function activityThreadMessage(pullRequest: { number: number; url: string }, text: string) {
  return `About pull request #${pullRequest.number} (${pullRequest.url}):\n\n${text.trim()}`;
}
