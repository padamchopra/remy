import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { HubThread, ReviewFinding } from "@remy/contract";
import { Bot, ChevronDown, MessagesSquare } from "lucide-react";
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuItemCheck, MenuTrigger } from "@/components/ui/menu-base";
import type { ChatCodeReference } from "@/state/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar-base";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog-base";
import { Spinner } from "@/components/ui/spinner";
import { Markdown } from "@/components/Markdown";
import { LinkedThreadChip, ThreadDot } from "@/components/PullRequestLinkedThread";
import { initials, timeAgo } from "@/lib/pull-request-detail";
import { lineCommentActions, lineRangeLabel, type LineCommentAction, type ReviewAuthor, type ReviewComment, type ReviewThread } from "@/lib/pull-request-review-state";
import { cn } from "@/lib/utils";

/// Where a line comment can go. Every box offers GitHub: Comment posts now,
/// Add to review queues it in your pending review. A destination beside those
/// is a Remy thread that reads it instead: the linked thread, and the review
/// agent's thread when this pull request has a review. With only the linked
/// thread the footer draws that thread's chip; with a review agent the chip
/// becomes a menu of the destinations that exist.
export interface LineCommentDestination {
  id: string;
  kind: "thread" | "review-agent";
  thread: HubThread;
  label: string;
}

export type { LineCommentAction };

/// What every comment box and conversation in the diff needs from the Files
/// tab, provided once rather than threaded through each hunk.
export interface ReviewSurface {
  viewer?: ReviewAuthor;
  repository: string;
  destinations: LineCommentDestination[];
  /// You have a pending review, so GitHub takes new comments only into it.
  pending: boolean;
  onOpenThread: (thread: HubThread) => void;
  onOpenLink: (href: string) => void;
  /// Posts a reply to a conversation, queues it, or sends it on.
  reply: (thread: ReviewThread, action: LineCommentAction, text: string, destination?: LineCommentDestination) => Promise<void>;
  editComment: (comment: ReviewComment, body: string) => Promise<void>;
  deleteComment: (comment: ReviewComment) => Promise<void>;
  openReply?: string;
  setOpenReply: (threadId: string | undefined) => void;
  /// The review agent's findings in the diff: drafting one into your pending
  /// review, dismissing it, and flagging it to the agent with why.
  addFinding?: (finding: ReviewFinding) => Promise<void>;
  dismissFinding?: (finding: ReviewFinding) => Promise<void>;
  flagFinding?: (finding: ReviewFinding, words: string, reference: ChatCodeReference) => Promise<void>;
  /// The finding the pane last asked the diff to show.
  focusedFinding?: string;
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

/// The chip on the left of a comment box with a review agent: which Remy
/// thread Send goes to, from the destinations that exist.
function DestinationMenu({ destinations, current, onChange }: {
  destinations: LineCommentDestination[];
  current: LineCommentDestination;
  onChange: (destination: LineCommentDestination) => void;
}) {
  const Icon = current.kind === "review-agent" ? Bot : MessagesSquare;
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Send to ${current.label}`}
        render={(
          <button
            type="button"
            data-slot="line-comment-destination"
            className="flex h-7 max-w-[300px] min-w-0 items-center gap-[7px] rounded-lg border border-input pr-2 pl-[9px] text-[11px] leading-4 text-foreground/70 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[popup-open]:bg-accent max-sm:max-w-full"
          />
        )}
      >
        <Icon aria-hidden className="size-[13px] shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{current.label}</span>
        <ThreadDot state={current.thread.detail.state} />
        <ChevronDown aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      </MenuTrigger>
      <MenuContent align="start" className="w-[380px] max-w-[var(--available-width)] rounded-[10px] p-1">
        <MenuGroup>
          <MenuGroupLabel className="px-2 pt-1.5 pb-1 text-[11px] leading-4 font-normal text-muted-foreground">Send to</MenuGroupLabel>
          {destinations.map((destination) => {
            const RowIcon = destination.kind === "review-agent" ? Bot : MessagesSquare;
            return (
              <MenuItem key={destination.id} onClick={() => onChange(destination)} className="h-8 gap-2 rounded-md px-2 text-xs">
                <RowIcon aria-hidden className="size-[13px] text-foreground/70" />
                <span className="min-w-0 flex-1 truncate">{destination.label}</span>
                <ThreadDot state={destination.thread.detail.state} />
                <MenuItemCheck checked={destination.id === current.id} />
              </MenuItem>
            );
          })}
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}

/// The comment box under a selection or a conversation. Which button you
/// press is where the comment goes: with a destination, Send is primary (⌘↵)
/// and names it; without one, Add to review is. With a pending review there is
/// no Comment, because GitHub refuses one posted now. Escape cancels.
export function LineCommentBox({
  viewer,
  destinations,
  pending = false,
  onOpenThread,
  onSubmit,
  onCancel,
  placeholder = "Leave a comment",
  initial = "",
  className,
}: {
  viewer?: ReviewAuthor;
  destinations: LineCommentDestination[];
  pending?: boolean;
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
  const [chosen, setChosen] = useState<string>();
  const destination = destinations.find((entry) => entry.id === chosen) ?? destinations[0];
  const menu = destinations.some((entry) => entry.kind === "review-agent");
  const { actions, primary } = lineCommentActions({ destination: Boolean(destination), pending });
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
        {destination && (menu
          ? <DestinationMenu destinations={destinations} current={destination} onChange={(next) => setChosen(next.id)} />
          : <LinkedThreadChip compact thread={destination.thread} onOpen={() => onOpenThread(destination.thread)} className="max-sm:max-w-full" />)}
        <span aria-hidden className="min-w-0 flex-1" />
        <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 max-sm:w-full">
          {actions.map((action) => (
            <span key={action} className="contents">
              {action === "review" && button("review", "Add to review")}
              {action === "comment" && button("comment", "Comment")}
              {action === "send" && destination && button("send", destination.kind === "review-agent" ? "Send to review agent" : "Send to thread", <span aria-hidden className="pl-0.5 font-mono text-[11px] leading-4 font-normal text-primary-foreground/75 max-sm:hidden">⌘↵</span>)}
            </span>
          ))}
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
          pending={surface.pending}
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
