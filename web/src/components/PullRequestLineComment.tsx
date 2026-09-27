import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { HubThread } from "@remy/contract";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar-base";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog-base";
import { Spinner } from "@/components/ui/spinner";
import { Markdown } from "@/components/Markdown";
import { LinkedThreadChip } from "@/components/PullRequestLinkedThread";
import { initials, timeAgo } from "@/lib/pull-request-detail";
import { lineRangeLabel, type ReviewAuthor, type ReviewComment, type ReviewThread } from "@/lib/pull-request-review-state";
import { cn } from "@/lib/utils";

/// Where a line comment can go. Every box offers GitHub: Comment posts now,
/// Add to review queues it in your pending review. A destination beside those
/// is a Remy thread that reads it instead; today that is only the linked
/// thread, and the footer draws it as that thread's chip. A second kind (the
/// review agent) turns the chip into a picker of destinations.
export interface LineCommentDestination {
  id: string;
  kind: "thread";
  thread: HubThread;
  label: string;
}

export type LineCommentAction = "comment" | "review" | "send";

/// What every comment box and conversation in the diff needs from the Files
/// tab, provided once rather than threaded through each hunk.
export interface ReviewSurface {
  viewer?: ReviewAuthor;
  repository: string;
  destinations: LineCommentDestination[];
  onOpenThread: (thread: HubThread) => void;
  onOpenLink: (href: string) => void;
  /// Posts a reply to a conversation, queues it, or sends it on.
  reply: (thread: ReviewThread, action: LineCommentAction, text: string, destination?: LineCommentDestination) => Promise<void>;
  editComment: (comment: ReviewComment, body: string) => Promise<void>;
  deleteComment: (comment: ReviewComment) => Promise<void>;
  openReply?: string;
  setOpenReply: (threadId: string | undefined) => void;
}

export const ReviewSurfaceContext = createContext<ReviewSurface | undefined>(undefined);

export function useReviewSurface() {
  const surface = useContext(ReviewSurfaceContext);
  if (!surface) throw new Error("A line comment needs the Files tab around it.");
  return surface;
}

/// A person's picture from GitHub, or their initials while it loads or when
/// there is none. `you` is the comment box's own avatar, in the primary colour.
export function ReviewAvatar({ author, you }: { author?: ReviewAuthor; you?: boolean }) {
  const name = author?.name || author?.login || "You";
  return (
    <Avatar className={cn("size-[22px]", you ? "bg-primary" : "bg-foreground/12")}>
      {author?.avatarUrl && <AvatarImage src={author.avatarUrl} alt="" />}
      <AvatarFallback className={cn("text-[9px] leading-3 font-semibold normal-case", you ? "text-primary-foreground" : "text-foreground/70")}>
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

const FOOTER_BUTTON = "h-7 rounded-lg px-3 text-xs leading-4 font-normal shadow-none";
const OUTLINE_BUTTON = cn(FOOTER_BUTTON, "border-input bg-transparent text-foreground/70 hover:text-foreground dark:bg-transparent");
const PRIMARY_BUTTON = cn(FOOTER_BUTTON, "font-semibold");

/// The comment box under a selection or a conversation. Which button you
/// press is where the comment goes: with a destination, its chip sits on the
/// left and Send to thread is primary (⌘↵); without one, Add to review is.
/// Escape cancels.
export function LineCommentBox({
  viewer,
  destinations,
  onOpenThread,
  onSubmit,
  onCancel,
  placeholder = "Leave a comment",
  initial = "",
  className,
}: {
  viewer?: ReviewAuthor;
  destinations: LineCommentDestination[];
  onOpenThread: (thread: HubThread) => void;
  onSubmit: (action: LineCommentAction, text: string, destination?: LineCommentDestination) => Promise<void>;
  onCancel: () => void;
  placeholder?: string;
  initial?: string;
  className?: string;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState<LineCommentAction>();
  const input = useRef<HTMLTextAreaElement>(null);
  const destination = destinations[0];
  const primary: LineCommentAction = destination ? "send" : "review";
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);

  const submit = async (action: LineCommentAction) => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(action);
    try {
      await onSubmit(action, value, action === "send" ? destination : undefined);
      setText("");
    } catch {
      // The caller already said what failed; the words stay for another try.
    } finally {
      setBusy(undefined);
    }
  };

  const button = (action: LineCommentAction, label: string, kbd?: ReactNode) => (
    <Button
      type="button"
      variant={action === primary ? "default" : "outline"}
      disabled={!text.trim() || Boolean(busy)}
      onClick={() => void submit(action)}
      className={action === primary ? PRIMARY_BUTTON : OUTLINE_BUTTON}
    >
      {busy === action && <Spinner data-icon="inline-start" />}
      {label}
      {kbd}
    </Button>
  );

  return (
    <div
      data-slot="line-comment"
      className={cn("flex min-w-0 flex-col overflow-hidden rounded-xl border border-primary bg-card", className)}
    >
      <div className="flex items-start gap-[9px] px-4 pt-3.5 pb-2.5">
        <ReviewAvatar author={viewer} you />
        <textarea
          ref={input}
          value={text}
          aria-label="Comment"
          placeholder={placeholder}
          maxLength={65_000}
          disabled={Boolean(busy)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
            else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit(primary); }
          }}
          rows={2}
          className="field-sizing-content max-h-72 min-h-[42px] min-w-0 flex-1 resize-none bg-transparent pt-px text-xs leading-[19px] text-foreground caret-primary outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        {destination && (
          <LinkedThreadChip compact thread={destination.thread} onOpen={() => onOpenThread(destination.thread)} className="max-sm:max-w-full" />
        )}
        <span aria-hidden className="min-w-0 flex-1" />
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 max-sm:w-full">
          {destination ? (
            <>
              {button("review", "Add to review")}
              {button("comment", "Comment")}
              {button("send", "Send to thread", <span aria-hidden className="pl-0.5 font-mono text-[11px] leading-4 font-normal text-primary-foreground/75 max-sm:hidden">⌘↵</span>)}
            </>
          ) : (
            <>
              {button("comment", "Comment")}
              {button("review", "Add to review")}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ tone, children }: { tone: "unresolved" | "resolved" | "pending" | "quiet"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-[5px] px-[7px] text-[10px] leading-[14px]",
        tone === "unresolved" && "bg-warning/15 font-medium text-warning-foreground",
        tone === "resolved" && "bg-success/12 font-medium text-success-foreground",
        tone === "pending" && "bg-primary/15 font-medium text-info-foreground",
        tone === "quiet" && "border border-foreground/12 text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function CommentView({ comment, lead, thread }: { comment: ReviewComment; lead: boolean; thread: ReviewThread }) {
  const surface = useReviewSurface();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState<"save" | "delete">();
  const [confirming, setConfirming] = useState(false);
  const name = comment.author.name || comment.author.login;
  const status = lead
    ? thread.comments.every((entry) => entry.pending)
      ? <Chip tone="pending">Pending</Chip>
      : thread.isResolved ? <Chip tone="resolved">Resolved</Chip> : <Chip tone="unresolved">Unresolved</Chip>
    : comment.pending ? <Chip tone="pending">Pending</Chip> : null;
  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy("save");
    try { await surface.editComment(comment, draft.trim()); setEditing(false); } catch { /* toast said why */ } finally { setBusy(undefined); }
  };
  const remove = async () => {
    setBusy("delete");
    try { await surface.deleteComment(comment); setConfirming(false); } catch { /* toast said why */ } finally { setBusy(undefined); }
  };
  return (
    <li data-slot="review-comment" className="flex flex-col gap-2 border-b border-border px-4 py-3.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-[9px]">
        <ReviewAvatar author={comment.author} />
        <a
          href={`https://github.com/${encodeURIComponent(comment.author.login)}`}
          target="_blank"
          rel="noreferrer"
          data-link
          title={comment.author.name ? comment.author.login : undefined}
          className="min-w-0 truncate text-xs leading-[18px] font-semibold text-foreground hover:underline"
        >
          {name}
        </a>
        <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-muted-foreground">{timeAgo(comment.createdAt)}</span>
        {comment.pending && !editing && (
          <span className="flex shrink-0 items-center gap-0.5">
            <Button type="button" variant="ghost" size="xs" className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground" onClick={() => { setDraft(comment.body); setEditing(true); }}>Edit</Button>
            <Button type="button" variant="ghost" size="xs" className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground" onClick={() => setConfirming(true)}>Delete</Button>
          </span>
        )}
        {status}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            aria-label="Edit comment"
            autoFocus
            maxLength={65_000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(false); }
              else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); }
            }}
            className="field-sizing-content min-h-[60px] w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-xs leading-[19px] outline-none focus-visible:border-primary"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className={OUTLINE_BUTTON} onClick={() => setEditing(false)}>Cancel</Button>
            <Button type="button" disabled={!draft.trim() || Boolean(busy)} className={PRIMARY_BUTTON} onClick={() => void save()}>
              {busy === "save" && <Spinner data-icon="inline-start" />}
              Save
            </Button>
          </div>
        </div>
      ) : (
        <Markdown text={comment.body} repository={surface.repository} onOpenLink={surface.onOpenLink} className="text-xs leading-[19px] text-foreground/70" />
      )}
      <Dialog open={confirming} onOpenChange={(open) => { if (!busy) setConfirming(open); }}>
        <DialogContent showCloseButton={false} className="gap-4 rounded-2xl bg-popover p-5 sm:max-w-[400px]">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-sm font-semibold">Delete this pending comment?</DialogTitle>
            <DialogDescription className="text-xs">It hasn't gone out yet, and it can't be brought back.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2.5">
            <DialogClose render={<Button type="button" variant="outline" disabled={Boolean(busy)} className={OUTLINE_BUTTON} />}>Cancel</DialogClose>
            <Button type="button" variant="destructive" disabled={Boolean(busy)} className={PRIMARY_BUTTON} onClick={() => void remove()}>
              {busy === "delete" && <Spinner data-icon="inline-start" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/// A GitHub review conversation drawn at its line: each comment with its
/// author, when, and body, the thread's state on the first, then a reply box
/// that follows the same footer rules as a new comment.
export function ReviewConversation({ thread, where, className }: { thread: ReviewThread; where?: string; className?: string }) {
  const surface = useReviewSurface();
  const replying = surface.openReply === thread.id;
  return (
    <div data-slot="review-conversation" className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-input bg-card">
        {(where || thread.isOutdated) && (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-[11px] leading-4 text-muted-foreground">
            {where && <span className="min-w-0 truncate font-mono">{where}</span>}
            {thread.isOutdated && <Chip tone="quiet">Outdated</Chip>}
          </div>
        )}
        <ol className="flex flex-col">
          {thread.comments.map((comment, index) => <CommentView key={comment.id} comment={comment} lead={index === 0} thread={thread} />)}
        </ol>
      </div>
      {replying ? (
        <LineCommentBox
          viewer={surface.viewer}
          destinations={surface.destinations}
          onOpenThread={surface.onOpenThread}
          placeholder="Reply"
          onCancel={() => surface.setOpenReply(undefined)}
          onSubmit={async (action, text, destination) => {
            await surface.reply(thread, action, text, destination);
            surface.setOpenReply(undefined);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => surface.setOpenReply(thread.id)}
          className="flex min-w-0 items-center gap-[9px] rounded-xl border border-input bg-card px-4 py-2.5 text-left text-xs leading-[19px] text-muted-foreground/80 outline-none hover:border-foreground/20 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ReviewAvatar author={surface.viewer} you />
          Reply
        </button>
      )}
    </div>
  );
}

/// Where an outdated conversation was, for its folded card.
export function conversationPlace(thread: ReviewThread): string {
  if (thread.file) return "This file";
  const line = thread.line ?? thread.originalLine;
  if (!line) return "";
  const start = thread.line ? thread.startLine : thread.originalStartLine;
  return `${thread.side === "LEFT" ? "Old " : ""}${lineRangeLabel(start, line)}`;
}
