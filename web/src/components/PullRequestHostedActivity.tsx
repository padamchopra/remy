import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CircleDot, CircleX, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import type { HubThread } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Markdown } from "@/components/Markdown";
import { pullRequestAction } from "@/components/PullRequestHostedActions";
import { LinkedThreadChip } from "@/components/PullRequestLinkedThread";
import { ReviewAvatar } from "@/components/PullRequestLineComment";
import { apiError } from "@/lib/api-error";
import { hubRequest, hubThreadPath } from "@/lib/hub-threads";
import {
  activityThreadMessage,
  activityTimeline,
  authorName,
  checksSentence,
  fromThreadLabel,
  reviewSentence,
  shortAgo,
  type ActivityAuthor,
  type ActivityEntry,
  type ActivityItem,
  type PullRequestActivity,
} from "@/lib/pull-request-activity";
import { cn } from "@/lib/utils";
import type { AuthoredPullRequest } from "@/components/PullRequests";

/// A line in the timeline: an icon in a fixed slot so every icon shares one
/// x, what happened, and when.
function Row({ icon, children, at }: { icon: ReactNode; children: ReactNode; at: string }) {
  return (
    <li data-slot="activity-row" className="flex min-w-0 items-center gap-2.5">
      <span className="flex size-[22px] shrink-0 items-center justify-center [&>svg]:size-[15px]">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-[18px] text-foreground/70">{children}</div>
      <time dateTime={at} title={new Date(at).toLocaleString()} className="shrink-0 text-[11px] leading-4 text-muted-foreground">{shortAgo(at)}</time>
    </li>
  );
}

function CommentCard({ item, repository, onOpenLink }: {
  item: Extract<ActivityItem, { kind: "comment" | "review" }>;
  repository: string;
  onOpenLink: (href: string) => void;
}) {
  const name = authorName(item.author);
  return (
    <li data-slot="activity-comment" className="flex min-w-0 flex-col gap-[7px] overflow-hidden rounded-xl border border-input bg-card px-[15px] py-[13px]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-[9px] gap-y-1">
        <ReviewAvatar author={item.author} />
        <a
          href={`https://github.com/${encodeURIComponent(item.author.login)}`}
          target="_blank"
          rel="noreferrer"
          data-link
          title={item.author.name ? item.author.login : undefined}
          className="min-w-0 truncate text-xs leading-[18px] font-semibold text-foreground hover:underline"
        >
          {name}
        </a>
        {item.kind === "review" && <span className="text-xs leading-[18px] text-foreground/70">{reviewSentence(item).slice(name.length + 1)}</span>}
        {item.thread && (
          <span data-slot="activity-from-thread" className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] border border-foreground/12 px-[7px] text-[10px] leading-[14px] text-muted-foreground">
            <MessagesSquare aria-hidden className="size-3" />
            {fromThreadLabel(item.thread)}
          </span>
        )}
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" data-link className="min-w-0 flex-1 truncate text-[11px] leading-4 text-muted-foreground hover:underline">
            <time dateTime={item.at} title={new Date(item.at).toLocaleString()}>{shortAgo(item.at)}</time>
          </a>
        ) : (
          <time dateTime={item.at} className="min-w-0 flex-1 truncate text-[11px] leading-4 text-muted-foreground">{shortAgo(item.at)}</time>
        )}
      </div>
      <Markdown text={item.body} repository={repository} onOpenLink={onOpenLink} className="text-xs leading-[19px] text-foreground/70" />
    </li>
  );
}

function ReviewIcon({ state }: { state: Extract<ActivityItem, { kind: "review" }>["state"] }) {
  if (state === "APPROVED") return <CircleCheck aria-label="Approved" className="text-success-foreground" />;
  if (state === "CHANGES_REQUESTED") return <CircleX aria-label="Changes requested" className="text-destructive" />;
  return <CircleDot aria-label="Reviewed" className="text-muted-foreground" />;
}

function Entry({ entry, repository, onOpenThread, onOpenLink }: {
  entry: ActivityEntry<HubThread>;
  repository: string;
  onOpenThread: (thread: HubThread) => void;
  onOpenLink: (href: string) => void;
}) {
  if (entry.kind === "comment") return <CommentCard item={entry} repository={repository} onOpenLink={onOpenLink} />;
  if (entry.kind === "review") {
    if (entry.body.trim()) return <CommentCard item={entry} repository={repository} onOpenLink={onOpenLink} />;
    return (
      <Row at={entry.at} icon={<ReviewIcon state={entry.state} />}>
        {entry.url ? <a href={entry.url} target="_blank" rel="noreferrer" data-link className="min-w-0 hover:underline">{reviewSentence(entry)}</a> : <span className="min-w-0">{reviewSentence(entry)}</span>}
      </Row>
    );
  }
  if (entry.kind === "checks") {
    return (
      <Row
        at={entry.at}
        icon={entry.state === "fail" ? <CircleX aria-label="Failed" className="text-destructive" /> : <CircleCheck aria-label="Passed" className="text-success-foreground" />}
      >
        <span className="min-w-0">{checksSentence(entry)}</span>
      </Row>
    );
  }
  return (
    <Row at={entry.at} icon={<MessagesSquare aria-hidden className="text-muted-foreground" />}>
      <span className="min-w-0">{entry.text}</span>
      <LinkedThreadChip compact thread={entry.thread} onOpen={() => onOpenThread(entry.thread)} className="h-6 max-w-[260px]" />
    </Row>
  );
}

const FOOTER_BUTTON = "h-7 rounded-lg px-3 text-xs leading-4 shadow-none";

/// The composer under the timeline follows the line-comment rules: with a
/// linked thread, Comment and Send to thread (primary, ⌘↵) beside that
/// thread's chip; without one, just Comment.
function Composer({ viewer, thread, onOpenThread, onComment, onSend }: {
  viewer?: ActivityAuthor;
  thread?: HubThread;
  onOpenThread: (thread: HubThread) => void;
  onComment: (text: string) => Promise<void>;
  onSend: (thread: HubThread, text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"comment" | "send">();
  const submit = async (action: "comment" | "send") => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(action);
    try {
      if (action === "send" && thread) await onSend(thread, value);
      else await onComment(value);
      setText("");
    } catch {
      // The toast said what failed; the words stay for another try.
    } finally {
      setBusy(undefined);
    }
  };
  const primary = thread ? "send" : "comment";
  return (
    <div data-slot="activity-composer" className="flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-input bg-card focus-within:border-primary">
      <div className="flex items-start gap-[9px] px-[15px] py-[13px]">
        <ReviewAvatar author={viewer} you />
        <textarea
          value={text}
          aria-label="Comment on this pull request"
          placeholder="Say something about this pull request"
          maxLength={60_000}
          disabled={Boolean(busy)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(primary); }
          }}
          rows={1}
          className="field-sizing-content max-h-72 min-h-[19px] min-w-0 flex-1 resize-none bg-transparent pt-px text-xs leading-[19px] text-foreground caret-primary outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        {thread && <LinkedThreadChip compact thread={thread} onOpen={() => onOpenThread(thread)} className="max-sm:max-w-full" />}
        <span aria-hidden className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant={primary === "comment" ? "default" : "outline"}
            disabled={!text.trim() || Boolean(busy)}
            onClick={() => void submit("comment")}
            className={cn(FOOTER_BUTTON, primary === "comment" ? "font-semibold" : "border-input bg-transparent font-normal text-foreground/70 hover:text-foreground dark:bg-transparent")}
          >
            {busy === "comment" && <Spinner data-icon="inline-start" />}
            Comment
            {primary === "comment" && <span aria-hidden className="pl-0.5 font-mono text-[11px] leading-4 font-normal text-primary-foreground/75 max-sm:hidden">⌘↵</span>}
          </Button>
          {thread && (
            <Button type="button" disabled={!text.trim() || Boolean(busy)} onClick={() => void submit("send")} className={cn(FOOTER_BUTTON, "font-semibold")}>
              {busy === "send" && <Spinner data-icon="inline-start" />}
              Send to thread
              <span aria-hidden className="pl-0.5 font-mono text-[11px] leading-4 font-normal text-primary-foreground/75 max-sm:hidden">⌘↵</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/// The Activity tab (Paper 513-0): one timeline of reviews, comments, check
/// results and what Remy's threads did, newest last, then the composer.
export function PullRequestHostedActivity({
  organizationId,
  pullRequest,
  activity,
  failed,
  thread,
  active,
  onOpenThread,
  onOpenLink,
  onCommented,
}: {
  organizationId: string;
  pullRequest: AuthoredPullRequest;
  activity?: PullRequestActivity;
  /// The hub cannot read the timeline; the comments the list carries stand in.
  failed: boolean;
  thread?: HubThread;
  active: boolean;
  onOpenThread: (thread: HubThread) => void;
  onOpenLink: (href: string) => void;
  onCommented: () => void;
}) {
  const entries = useMemo<ActivityEntry<HubThread>[]>(() => {
    if (activity) return activityTimeline(activity, thread);
    if (!failed) return [];
    return (pullRequest.comments ?? []).map((comment, index) => ({
      kind: "comment" as const,
      id: comment.url || `comment:${index}`,
      at: comment.createdAt ?? "",
      author: { login: comment.author, name: null, avatarUrl: null },
      body: comment.body,
      url: comment.url || null,
      thread: null,
    })).sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  }, [activity, failed, pullRequest.comments, thread]);

  // Newest is last, beside the composer, so the view starts at the bottom.
  const end = useRef<HTMLDivElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    if (!active || settled.current || (!activity && !failed)) return;
    settled.current = true;
    end.current?.scrollIntoView({ block: "end" });
  }, [active, activity, failed]);

  const comment = async (text: string) => {
    try {
      await pullRequestAction(organizationId, pullRequest.workspaceId, pullRequest.number, "comment", { body: text });
      toast.success("Your comment is on GitHub.");
      onCommented();
    } catch (caught) {
      toast.error("Couldn't post your comment", { description: apiError(caught) });
      throw caught;
    }
  };
  const send = async (target: HubThread, text: string) => {
    try {
      await hubRequest(`${hubThreadPath(target.access.organizationId, target.computerId, target.id)}/message`, "POST", {
        text: activityThreadMessage(pullRequest, text),
        messageId: `u-${crypto.randomUUID()}`,
        attachmentIds: [],
      });
      toast.success("Your thread has it.");
    } catch (caught) {
      toast.error("Couldn't send it to the thread", { description: apiError(caught) });
      throw caught;
    }
  };

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1" viewportProps={{ tabIndex: 0, "aria-label": "Pull request activity" }}>
      <div className="flex max-w-[820px] flex-col gap-5 px-4 pt-[22px] pb-6 sm:px-7">
        {!activity && !failed ? (
          <p className="shimmer text-xs leading-[18px] text-muted-foreground">Reading the activity…</p>
        ) : entries.length === 0 ? (
          <p className="text-xs leading-[18px] text-muted-foreground">No reviews or comments yet.</p>
        ) : (
          <ol aria-label="Timeline" className="flex flex-col gap-4">
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} repository={pullRequest.repository} onOpenThread={onOpenThread} onOpenLink={onOpenLink} />
            ))}
          </ol>
        )}
        <Composer viewer={activity?.viewerAuthor ?? (activity?.viewer ? { login: activity.viewer, name: null, avatarUrl: null } : undefined)} thread={thread} onOpenThread={onOpenThread} onComment={comment} onSend={send} />
        <div ref={end} aria-hidden />
      </div>
    </ScrollArea>
  );
}
