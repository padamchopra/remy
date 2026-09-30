import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Code, FileDiff, List, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { HubThread, ReviewFinding, ReviewState } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox-base";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible-base";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover-base";
import { Skeleton } from "@/components/ui/skeleton";
import { pullRequestAction } from "@/components/PullRequestHostedActions";
import { PullRequestCommits } from "@/components/PullRequestCommits";
import { FinishReview } from "@/components/PullRequestFinishReview";
import { ReviewFindingCard } from "@/components/PullRequestReviewFinding";
import {
  conversationPlace,
  LineCommentBox,
  ReviewConversation,
  ReviewSurfaceContext,
  type LineCommentAction,
  type LineCommentDestination,
  type ReviewSurface,
} from "@/components/PullRequestLineComment";
import { apiError } from "@/lib/api-error";
import { splitByRanges, hunkWordDiff, type WordRange } from "@/lib/diff-words";
import { hubRequest, HubRequestError, hubThreadBase, hubThreadPath } from "@/lib/hub-threads";
import { parsePullRequestPatch } from "@/lib/pull-request-patch";
import { findingLines, flagFindingMessage, placeFindings, setFindingStatus } from "@/lib/review-agent";
import {
  extendSelection,
  hasPendingReview,
  isOwnPullRequest,
  isViewed,
  lineCommentReference,
  lineNumberOn,
  lineSide,
  placeThreads,
  queuedComments,
  selectionTarget,
  type HostedReview,
  type LineSelection,
  type ReviewThread,
  type ViewedState,
} from "@/lib/pull-request-review-state";
import { cn } from "@/lib/utils";
import type { AuthoredPullRequest } from "@/components/PullRequests";
import type { PullRequestDiffHunk, PullRequestDiffLine } from "@/state/types";

/// One changed file as the hub reads it from GitHub. `patch` is missing for a
/// binary file or one GitHub will not diff; `patchOmitted` means the hub had
/// already carried as much patch text as one answer holds.
interface HostedFile {
  path: string;
  previousPath?: string;
  commitSha?: string;
  commitTitle?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  patchOmitted?: boolean;
}

interface HostedFiles {
  files: HostedFile[];
  truncated?: boolean;
  patchesOmitted?: boolean;
}

/// A file this long starts folded, so one generated file cannot bury the rest.
const LARGE_FILE_LINES = 400;
const LINE_HEIGHT = 20;

function fileId(index: number) {
  return `pull-request-file-${index}`;
}

function useHostedFiles(organizationId: string, pullRequest: AuthoredPullRequest, commits: string[]) {
  const [state, setState] = useState<{ files?: HostedFiles; error?: string }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setState({});
    const params = new URLSearchParams({
      repository: pullRequest.repository,
      number: String(pullRequest.number),
      ...(pullRequest.changedFiles ? { changedFiles: String(pullRequest.changedFiles) } : {}),
    });
    for (const sha of commits) params.append("commit", sha);
    hubRequest<HostedFiles>(`${hubThreadBase(organizationId)}/github/pull-request-files?${params}`)
      .then((files) => { if (commits.length && files.files.some(file => !file.commitSha)) throw new Error("Commit filtering is not available on this hub yet."); if (current) setState({ files: { ...files, files: Array.isArray(files.files) ? files.files : [] } }); })
      .catch((error) => { if (current) setState({ error: apiError(error) }); });
    return () => { current = false; };
    // The file list is read again only when asked; `updatedAt` names the revision.
  }, [organizationId, pullRequest.repository, pullRequest.number, pullRequest.changedFiles, pullRequest.updatedAt, commits.join(","), attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}

/// GitHub's viewed marks and review conversations for this pull request. A
/// refresh keeps what is on screen until the new read lands, so a posted
/// comment does not flash the diff empty.
function useHostedReview(organizationId: string, pullRequest: AuthoredPullRequest) {
  const [review, setReview] = useState<HostedReview>();
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const read = useCallback(async () => {
    const id = ++request.current;
    const params = new URLSearchParams({ repository: pullRequest.repository, number: String(pullRequest.number) });
    try {
      const value = await hubRequest<HostedReview>(`${hubThreadBase(organizationId)}/github/pull-request-review?${params}`);
      if (id !== request.current) return;
      setReview({ ...value, viewed: value.viewed ?? {}, threads: Array.isArray(value.threads) ? value.threads : [] });
      setError(undefined);
    } catch (caught) {
      // A hub without this read answers with a bare 404; the diff stays useful.
      const missing = caught instanceof HubRequestError && caught.status === 404 && !/workspaces/.test(caught.message);
      if (id === request.current) setError(missing ? "Comments and read marks aren't available yet." : `Comments and read marks didn't load. ${apiError(caught)}`);
    }
  }, [organizationId, pullRequest.repository, pullRequest.number]);
  useEffect(() => {
    setReview(undefined);
    setError(undefined);
    void read();
  }, [read, pullRequest.updatedAt]);
  return { review, error, refresh: read, setReview };
}

function Totals({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2 font-mono tabular-nums", className)} aria-label={`${additions} additions, ${deletions} deletions`}>
      <span className={additions ? "text-success-foreground" : "text-muted-foreground/60"}>+{additions.toLocaleString()}</span>
      <span className={deletions ? "text-destructive-foreground" : "text-muted-foreground/60"}>−{deletions.toLocaleString()}</span>
    </span>
  );
}

/// Lines of a hunk draw only once they come near the screen; until then a box
/// of the same height holds their place, so a long pull request opens at once
/// and the scrollbar is already the right length.
function useNearScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: "1200px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near] as const;
}

const ROW_TONE = {
  add: { row: "bg-diff-add", number: "text-diff-add-number", text: "text-diff-add-text", marker: "text-success-foreground", word: "bg-diff-add-word" },
  del: { row: "bg-diff-del", number: "text-diff-del-number", text: "text-diff-del-text", marker: "text-destructive-foreground", word: "bg-diff-del-word" },
  ctx: { row: "", number: "text-muted-foreground/65", text: "text-foreground/70", marker: "text-transparent", word: "" },
} as const;

/// One diff row: two line numbers, the +/− marker, and the code, with the
/// words that changed in it marked. Clicking a number (or the row, when no
/// text is being selected) chooses the line; shift-click extends to it.
const DiffRow = memo(function DiffRow({ line, index, marks, selected, first, last, readOnly, onSelect }: {
  line: PullRequestDiffLine;
  index: number;
  marks?: readonly WordRange[];
  selected: boolean;
  first: boolean;
  last: boolean;
  readOnly?: boolean;
  onSelect: (index: number, extend: boolean) => void;
}) {
  const tone = ROW_TONE[line.kind];
  const number = selected ? "text-diff-selected-number" : tone.number;
  const side = lineSide(line);
  const label = `${readOnly ? "Line" : "Comment on line"} ${lineNumberOn(line, side) ?? ""}`;
  return (
    <div
      data-slot="diff-row"
      data-kind={line.kind}
      data-selected={selected || undefined}
      onClick={(event) => {
        if (window.getSelection()?.toString()) return;
        if (!readOnly) onSelect(index, event.shiftKey);
      }}
      className={cn(
        "grid min-h-5 cursor-default grid-cols-[2.75rem_1rem_minmax(0,1fr)] sm:grid-cols-[2.75rem_2.75rem_1rem_minmax(0,1fr)]",
        selected ? "bg-diff-selected" : tone.row,
        selected && first && "shadow-[inset_0_1px_0_var(--primary)]",
        selected && last && "shadow-[inset_0_-1px_0_var(--primary)]",
        selected && first && last && "shadow-[inset_0_1px_0_var(--primary),inset_0_-1px_0_var(--primary)]",
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        disabled={readOnly}
        aria-label={label}
        onClick={(event) => { event.stopPropagation(); onSelect(index, event.shiftKey); }}
        className={cn("hidden pr-2.5 text-right tabular-nums select-none sm:block", number)}
      >
        {line.oldLine ?? ""}
      </button>
      <button
        type="button"
        tabIndex={-1}
        disabled={readOnly}
        aria-label={label}
        onClick={(event) => { event.stopPropagation(); onSelect(index, event.shiftKey); }}
        className={cn("pr-2.5 text-right tabular-nums select-none", number)}
      >
        <span className="sm:hidden">{line.newLine ?? line.oldLine}</span>
        <span className="hidden sm:inline">{line.newLine ?? ""}</span>
      </button>
      <span aria-hidden className={cn("select-none", tone.marker)}>{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
      <span className={cn("pr-4 break-words whitespace-pre-wrap", selected ? "text-diff-selected-text" : tone.text)}>
        {line.text
          ? splitByRanges(line.text, marks).map((piece, at) => piece.marked
            ? <mark key={at} className={cn("rounded-[3px] text-inherit", tone.word)}>{piece.text}</mark>
            : piece.text)
          : " "}
      </span>
    </div>
  );
});

/// A conversation's rows in this hunk, so a reply sent to a thread carries
/// the code it is about.
function conversationTarget(lines: readonly PullRequestDiffLine[], thread: ReviewThread) {
  if (!thread.line) return undefined;
  const end = lines.findIndex((line) => lineNumberOn(line, thread.side) === thread.line && (thread.side === "LEFT" ? line.kind !== "add" : line.kind !== "del"));
  if (end < 0) return undefined;
  const start = thread.startLine ? lines.findIndex((line) => lineNumberOn(line, thread.side) === thread.startLine) : end;
  return selectionTarget(lines, { anchor: end, focus: start < 0 ? end : start });
}

interface HunkProps {
  hunk: PullRequestDiffHunk;
  hunkIndex: number;
  path: string;
  selection?: LineSelection;
  threadsAt: Map<string, ReviewThread[]>;
  findingsAt: Map<string, ReviewFinding[]>;
  /// Draw the rows now, for a finding the pane asked to show.
  eager?: boolean;
  readOnly?: boolean;
  onSelect: (path: string, hunk: number, index: number, extend: boolean) => void;
  composer?: ReactNode;
}

const Hunk = memo(function Hunk({ hunk, hunkIndex, path, selection, threadsAt, findingsAt, eager, readOnly, onSelect, composer }: HunkProps) {
  const [ref, seen] = useNearScreen<HTMLDivElement>();
  const near = seen || Boolean(eager);
  const marks = useMemo(() => (near ? hunkWordDiff(hunk.lines) : new Map<number, WordRange[]>()), [near, hunk.lines]);
  const mine = selection?.hunk === hunkIndex ? selection : undefined;
  const from = mine ? Math.min(mine.anchor, mine.focus) : -1;
  const to = mine ? Math.max(mine.anchor, mine.focus) : -1;
  const select = useCallback((index: number, extend: boolean) => onSelect(path, hunkIndex, index, extend), [onSelect, path, hunkIndex]);
  const selected = (index: number) => index >= from && index <= to;
  return (
    <div data-slot="diff-hunk" className="border-t border-border first:border-t-0">
      <div className="flex h-[26px] items-center border-b border-border bg-card px-4 font-mono text-[11px] leading-4 text-muted-foreground">
        <span className="min-w-0 truncate">{hunk.header}</span>
      </div>
      <div ref={ref} className="font-mono text-[11px] leading-5" style={near ? undefined : { height: hunk.lines.length * LINE_HEIGHT }}>
        {near && hunk.lines.map((line, index) => {
          const threads = threadsAt.get(`${hunkIndex}:${index}`);
          const findings = findingsAt.get(`${hunkIndex}:${index}`);
          return (
            <div key={index} className="contents">
              <DiffRow
                line={line}
                readOnly={readOnly}
                index={index}
                marks={marks.get(index)}
                selected={selected(index)}
                first={index === from}
                last={index === to}
                onSelect={select}
              />
              {index === to && composer && (
                <div className="pt-3 pr-4 pb-5 pl-3 font-sans sm:pl-[60px]">{composer}</div>
              )}
              {threads?.map((thread) => (
                <div key={thread.id} className="pt-3.5 pr-4 pb-5 pl-3 font-sans sm:pl-[60px]">
                  <ReviewConversation thread={thread} />
                </div>
              ))}
              {findings?.map((finding) => (
                <div key={finding.id} className="py-3 pr-4 pl-3 font-sans sm:pl-[60px]">
                  <ReviewFindingCard finding={finding} lines={hunk.lines} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
});

function MarkRead({ path, viewed, disabled, onChange, compact }: {
  path: string;
  viewed: boolean;
  disabled: boolean;
  onChange: (viewed: boolean) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <Checkbox
        checked={viewed}
        disabled={disabled}
        aria-label={`${viewed ? "Mark unread" : "Mark read"}: ${path}`}
        onCheckedChange={(checked) => onChange(checked === true)}
        className="size-[13px] rounded-[4px] border-foreground/20"
      />
    );
  }
  return (
    <label
      className={cn(
        "flex h-6 shrink-0 items-center gap-1.5 rounded-[7px] border border-input px-[9px] @max-[600px]/file:px-2 text-[11px] leading-[14px] text-foreground/70",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:text-foreground",
      )}
    >
      <Checkbox
        checked={viewed}
        disabled={disabled}
        aria-label={`Mark read: ${path}`}
        onCheckedChange={(checked) => onChange(checked === true)}
        className="size-[11px] rounded-[3px] border-foreground/20"
      />
      <span className="@max-[600px]/file:sr-only">Mark read</span>
    </label>
  );
}

const FileDiffView = memo(function FileDiffView({
  file,
  index,
  open,
  viewed,
  canMarkRead,
  onOpenChange,
  onViewedChange,
  url,
  threads,
  findings,
  focusedFinding,
  selection,
  onSelect,
  composer,
}: {
  file: HostedFile;
  index: number;
  open: boolean;
  viewed: boolean;
  canMarkRead: boolean;
  onOpenChange: (index: number, open: boolean) => void;
  onViewedChange: (path: string, viewed: boolean) => void;
  url: string;
  threads: readonly ReviewThread[];
  findings: readonly ReviewFinding[];
  focusedFinding?: string;
  selection?: LineSelection;
  onSelect: (path: string, hunk: number, index: number, extend: boolean) => void;
  composer?: ReactNode;
}) {
  const hunks = useMemo(() => (file.patch ? parsePullRequestPatch(file.patch) : []), [file.patch]);
  const placed = useMemo(() => placeThreads(threads, file.path, hunks), [threads, file.path, hunks]);
  const agent = useMemo(() => placeFindings(findings, file.path, hunks), [findings, file.path, hunks]);
  const name = file.path.split("/").at(-1) ?? file.path;
  const folder = file.path.slice(0, file.path.length - name.length);
  const elsewhere = placed.elsewhere;
  const outdated = elsewhere.every((thread) => thread.isOutdated);
  const [foldOpen, setFoldOpen] = useState(false);
  // A finding the pane points at that is off these lines opens the fold it sits in.
  useEffect(() => {
    if (focusedFinding && agent.elsewhere.some((finding) => finding.id === focusedFinding)) setFoldOpen(true);
  }, [focusedFinding, agent.elsewhere]);
  const focusedHunk = focusedFinding
    ? [...agent.atRow.entries()].find(([, list]) => list.some((finding) => finding.id === focusedFinding))?.[0].split(":")[0]
    : undefined;
  const foldLabel = [
    elsewhere.length ? (outdated
      ? `${elsewhere.length} outdated ${elsewhere.length === 1 ? "conversation" : "conversations"}`
      : `${elsewhere.length} ${elsewhere.length === 1 ? "conversation" : "conversations"} not on these lines`) : "",
    agent.elsewhere.length ? `${agent.elsewhere.length} ${agent.elsewhere.length === 1 ? "finding" : "findings"} not on these lines` : "",
  ].filter(Boolean).join(" · ");
  return (
    <Collapsible
      id={fileId(index)}
      data-index={index}
      open={open}
      onOpenChange={(next) => onOpenChange(index, next)}
      data-slot="pull-request-file"
      className="@container/file scroll-mt-0 border-b border-border last:border-b-0"
    >
      {/* One pixel above the edge: at a fractional scroll position a header pinned at 0 can sit half a pixel low and let the diff show through above it. */}
      <div data-slot="file-toolbar" className="sticky -top-px z-10 flex h-10 min-w-0 items-center gap-2 border-b border-border bg-background px-3">
        <CollapsibleTrigger
          data-file-index={index}
          aria-label={`${open ? "Collapse" : "Expand"} ${file.path}`}
          className="group/file flex h-full min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          <Code aria-hidden className="hidden size-3.5 shrink-0 text-muted-foreground group-data-[panel-open]/file:block" />
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground group-data-[panel-open]/file:hidden" />
          <span className="flex min-w-0 flex-1 items-baseline font-mono text-[11px] leading-4" title={file.previousPath && file.previousPath !== file.path ? `${file.previousPath} → ${file.path}` : file.path}>
            {file.previousPath && file.previousPath !== file.path && (
              <span className="mr-1.5 max-w-[40%] min-w-0 shrink truncate text-muted-foreground">{file.previousPath} →</span>
            )}
            <span className="min-w-0 shrink truncate text-muted-foreground [direction:rtl] @max-[600px]/file:hidden"><bdi>{folder}</bdi></span>
            <span className="min-w-0 truncate font-[550] text-foreground">{name}</span>
          </span>
        </CollapsibleTrigger>
        <Totals additions={file.additions} deletions={file.deletions} className="text-[11px] leading-4" />
        <MarkRead path={file.path} viewed={viewed} disabled={!canMarkRead} onChange={(next) => onViewedChange(file.path, next)} />
      </div>
      <CollapsibleContent>
        {(elsewhere.length > 0 || agent.elsewhere.length > 0) && (
          <Collapsible open={foldOpen} onOpenChange={setFoldOpen} className="border-b border-border">
            <CollapsibleTrigger className="group/elsewhere flex h-8 w-full items-center gap-2 px-4 text-left text-[11px] leading-4 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50">
              <ChevronRight aria-hidden className="size-3 transition-transform group-data-[panel-open]/elsewhere:rotate-90" />
              {foldLabel}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-col gap-4 pt-1 pr-4 pb-5 pl-3 sm:pl-[60px]">
                {elsewhere.map((thread) => <ReviewConversation key={thread.id} thread={thread} where={conversationPlace(thread)} />)}
                {agent.elsewhere.map((finding) => <ReviewFindingCard key={finding.id} finding={finding} where={findingLines(finding)} />)}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        {file.patch ? (
          hunks.map((hunk, hunkIndex) => (
            <Hunk
              key={`${hunk.header}:${hunkIndex}`}
              hunk={hunk}
              hunkIndex={hunkIndex}
              path={file.path}
              selection={selection}
              threadsAt={placed.atRow}
              findingsAt={agent.atRow}
              eager={focusedHunk === String(hunkIndex)}
              readOnly={!!file.commitSha}
              onSelect={onSelect}
              composer={selection?.hunk === hunkIndex ? composer : undefined}
            />
          ))
        ) : (
          <p className="flex flex-wrap items-center justify-center gap-x-1 px-3 py-6 text-center text-xs text-muted-foreground">
            {file.patchOmitted
              ? "This diff is too large to show here."
              : file.status === "renamed" && file.additions + file.deletions === 0 ? "Renamed without changes." : "GitHub has no text diff for this file."}
            <a href={`${url}/files`} target="_blank" rel="noreferrer" data-link className="underline underline-offset-2 hover:text-foreground">Open on GitHub</a>
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
});

function initiallyOpen(files: HostedFile[], review: HostedReview | undefined) {
  return new Set(files.flatMap((file, index) => (
    file.additions + file.deletions <= LARGE_FILE_LINES && !isViewed(review, file.path) ? [index] : []
  )));
}

/// The files a pull request changes: a list with read marks beside one diff
/// per file. Choosing lines opens a comment box right under them; which button
/// you press is where it goes. `j` and `k` move between files the way they do
/// on GitHub.
export function PullRequestHostedFiles({ organizationId, pullRequest, active, thread, review: agentReview, reviewThread, onReviewChanged, focusFinding, onOpenThread, onOpenLink, toolbar, selectedCommits, onSelectedCommitsChange }: {
  organizationId: string;
  pullRequest: AuthoredPullRequest;
  active: boolean;
  /// The pull request's linked thread, when there is one: Send to thread goes there.
  thread?: HubThread;
  /// Your review agent's review and its thread, when there is one: its
  /// findings sit at their lines, and Send can go to it.
  review?: ReviewState | null;
  reviewThread?: HubThread;
  onReviewChanged?: (review: ReviewState) => void;
  /// A finding the pane asked to show; `at` changes on every ask.
  focusFinding?: { id: string; at: number };
  onOpenThread: (thread: HubThread) => void;
  onOpenLink: (href: string) => void;
  /// Where Finish review sits: the tab row of the pull request.
  toolbar?: HTMLElement | null;
  selectedCommits: string[];
  onSelectedCommitsChange: (commits: string[]) => void;
}) {
  const { files: read, error, retry } = useHostedFiles(organizationId, pullRequest, selectedCommits);
  const { review, error: reviewError, refresh, setReview } = useHostedReview(organizationId, pullRequest);
  const files = read?.files;
  useEffect(() => { setSelection(undefined); setOpenReply(undefined); setCurrent(0); }, [selectedCommits.join(",")]);
  const [filesOpen, setFilesOpen] = useState(false);
  const selectedFileElement = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState(0);
  const [selection, setSelection] = useState<LineSelection>();
  const [openReply, setOpenReply] = useState<string>();
  const viewport = useRef<HTMLDivElement>(null);
  const reviewSeen = useRef(false);

  useEffect(() => { reviewSeen.current = false; if (files) setOpen(initiallyOpen(files, undefined)); }, [files]);
  // A file you already read folds once GitHub says so, the first time only;
  // after that what you open stays open.
  useEffect(() => {
    if (!files || !review || reviewSeen.current || selectedCommits.length) return;
    reviewSeen.current = true;
    setOpen((value) => new Set([...value].filter((index) => !isViewed(review, files[index]!.path))));
  }, [files, review, selectedCommits.length]);

  const onOpenChange = useCallback((index: number, next: boolean) => {
    setOpen((value) => {
      const copy = new Set(value);
      if (next) copy.add(index); else copy.delete(index);
      return copy;
    });
  }, []);

  const reviewRef = useRef(review);
  reviewRef.current = review;
  const filesRef = useRef(files);
  filesRef.current = files;

  /// Read marks change on screen at once and on GitHub behind it; a refusal
  /// puts the mark back and says why.
  const onViewedChange = useCallback((path: string, viewed: boolean) => {
    const before = reviewRef.current?.viewed[path] ?? "UNVIEWED";
    const next: ViewedState = viewed ? "VIEWED" : "UNVIEWED";
    const set = (state: ViewedState) => setReview((value) => value ? { ...value, viewed: { ...value.viewed, [path]: state } } : value);
    set(next);
    const index = filesRef.current?.findIndex((file) => file.path === path) ?? -1;
    if (index >= 0) onOpenChange(index, !viewed);
    pullRequestAction(organizationId, pullRequest.workspaceId, pullRequest.number, "view-file", { path, viewed })
      .catch((caught) => {
        set(before);
        if (index >= 0) onOpenChange(index, viewed);
        toast.error(viewed ? "Couldn't mark the file read" : "Couldn't mark the file unread", { description: apiError(caught) });
      });
  }, [organizationId, pullRequest.workspaceId, pullRequest.number, setReview, onOpenChange]);

  const onSelect = useCallback((path: string, hunk: number, index: number, extend: boolean) => {
    if (selectedCommits.length) return;
    setOpenReply(undefined);
    setSelection((previous) => {
      if (extend && previous && previous.path === path && previous.hunk === hunk) {
        const file = filesRef.current?.find((entry) => entry.path === path);
        const lines = file?.patch ? parsePullRequestPatch(file.patch)[hunk]?.lines ?? [] : [];
        return { ...previous, focus: extendSelection(lines, previous.anchor, index) };
      }
      return { path, hunk, anchor: index, focus: index };
    });
  }, [selectedCommits.length]);

  const scrollArea = () => viewport.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']");
  const goTo = useCallback((index: number, { reveal = false } = {}) => {
    if (!files?.length) return;
    const next = Math.max(0, Math.min(files.length - 1, index));
    setCurrent(next);
    if (reveal) onOpenChange(next, true);
    const element = viewport.current?.querySelector<HTMLElement>(`[id="${fileId(next)}"]`);
    element?.scrollIntoView({ block: "start" });
    element?.querySelector<HTMLElement>("[data-file-index]")?.focus({ preventScroll: true });
  }, [files, onOpenChange]);

  // The file whose header is at the top is the one you are reading.
  useEffect(() => {
    const root = scrollArea();
    if (!root || !files?.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .map((entry) => Number((entry.target as HTMLElement).dataset.index));
      if (visible.length) setCurrent(Math.min(...visible));
    }, { root, rootMargin: "0px 0px -70% 0px" });
    for (const element of root.querySelectorAll<HTMLElement>("[data-slot='pull-request-file']")) observer.observe(element);
    return () => observer.disconnect();
  }, [files]);

  useEffect(() => {
    if (!active || !files?.length) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      if (event.key === "Escape" && selection) { event.preventDefault(); setSelection(undefined); }
      else if (event.key === "j") { event.preventDefault(); goTo(current + 1); }
      else if (event.key === "k") { event.preventDefault(); goTo(current - 1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, files, current, goTo, selection]);

  const destinations = useMemo<LineCommentDestination[]>(
    () => [
      ...(reviewThread ? [{ id: `review:${reviewThread.id}`, kind: "review-agent" as const, thread: reviewThread, label: "Review agent" }] : []),
      ...(thread ? [{ id: `thread:${thread.id}`, kind: "thread" as const, thread, label: thread.detail.title || "Untitled thread" }] : []),
    ],
    [thread, reviewThread],
  );
  const reached = (destination: LineCommentDestination, what: string) =>
    destination.kind === "review-agent" ? `The review agent has the ${what}.` : `Your thread has the ${what}.`;

  const sendToThread = useCallback(async (destination: LineCommentDestination, text: string, reference: ReturnType<typeof lineCommentReference>) => {
    const target = destination.thread;
    await hubRequest(`${hubThreadPath(target.access.organizationId, target.computerId, target.id)}/message`, "POST", {
      text,
      messageId: `u-${crypto.randomUUID()}`,
      attachmentIds: [],
      codeReferences: [reference],
    });
  }, []);

  const act = useCallback(async (action: Parameters<typeof pullRequestAction>[3], input: Record<string, unknown>, failure: string) => {
    try {
      await pullRequestAction(organizationId, pullRequest.workspaceId, pullRequest.number, action, input);
    } catch (caught) {
      toast.error(failure, { description: apiError(caught) });
      // GitHub says you have a pending review this screen hadn't seen: read
      // it, so the box offers Add to review instead of Comment.
      if (caught instanceof HubRequestError && caught.status === 409) void refresh();
      throw caught;
    }
  }, [organizationId, pullRequest.workspaceId, pullRequest.number, refresh]);

  const submitSelection = useCallback(async (action: LineCommentAction, text: string, destination?: LineCommentDestination) => {
    const chosen = selection;
    const file = chosen && filesRef.current?.find((entry) => entry.path === chosen.path);
    const lines = file?.patch ? parsePullRequestPatch(file.patch)[chosen!.hunk]?.lines ?? [] : [];
    const target = chosen ? selectionTarget(lines, chosen) : undefined;
    if (!chosen || !target) return;
    if (action === "send" && destination) {
      try {
        await sendToThread(destination, text, lineCommentReference(chosen.path, target, text));
      } catch (caught) {
        toast.error(destination.kind === "review-agent" ? "Couldn't send the comment to the review agent" : "Couldn't send the comment to your thread", { description: apiError(caught) });
        throw caught;
      }
      toast.success(reached(destination, "comment"));
    } else {
      const where = { path: chosen.path, line: target.line, side: target.side, ...(target.startLine ? { startLine: target.startLine, startSide: target.side } : {}), body: text };
      if (action === "comment") {
        await act("line-comment", where, "Couldn't post the comment");
        toast.success("Your comment is on GitHub.");
      } else {
        await act("pending-comment", where, "Couldn't add the comment to your review");
      }
      void refresh();
    }
    setSelection(undefined);
  }, [selection, sendToThread, act, refresh]);

  // The finding the pane pointed at is marked for a moment once it is in view.
  const [highlighted, setHighlighted] = useState<string>();
  useEffect(() => {
    if (!focusFinding) return;
    setHighlighted(focusFinding.id);
    const timer = window.setTimeout(() => setHighlighted(undefined), 1600);
    return () => window.clearTimeout(timer);
  }, [focusFinding]);

  const agentReviewRef = useRef(agentReview);
  agentReviewRef.current = agentReview;
  /// Your decision on a finding: on screen at once, from the hub's answer.
  const markFinding = useCallback(async (finding: ReviewFinding, status: "open" | "dismissed" | "added-to-github", githubCommentId?: string) => {
    let updated: ReviewFinding;
    try {
      updated = await setFindingStatus(organizationId, finding.id, status, githubCommentId);
    } catch (caught) {
      toast.error(status === "dismissed" ? "Couldn't dismiss the finding" : status === "open" ? "Couldn't bring the finding back" : "Couldn't mark the finding added", { description: apiError(caught) });
      throw caught;
    }
    const current = agentReviewRef.current;
    if (current) onReviewChanged?.({ ...current, findings: current.findings.map((entry) => (entry.id === updated.id ? updated : entry)) });
  }, [organizationId, onReviewChanged]);

  const pending = hasPendingReview(review);
  const surface = useMemo<ReviewSurface>(() => ({
    viewer: review?.viewer,
    repository: pullRequest.repository,
    destinations,
    pending,
    onOpenThread,
    onOpenLink,
    openReply,
    setOpenReply: (id) => { setOpenReply(id); if (id) setSelection(undefined); },
    reply: async (conversation, action, text, destination) => {
      if (action === "send" && destination) {
        const file = filesRef.current?.find((entry) => entry.path === conversation.path);
        const hunks = file?.patch ? parsePullRequestPatch(file.patch) : [];
        const target = hunks.map((hunk) => conversationTarget(hunk.lines, conversation)).find(Boolean);
        const quoted = conversation.comments.filter((comment) => !comment.pending)
          .map((comment) => `> ${comment.author.name || comment.author.login}: ${comment.body.split("\n").join("\n> ")}`).join("\n>\n");
        const message = `${text}\n\nThis replies to a review conversation on GitHub:\n${quoted}`;
        try {
          if (target) await sendToThread(destination, message, lineCommentReference(conversation.path, target, text));
          else {
            const at = destination.thread;
            await hubRequest(`${hubThreadPath(at.access.organizationId, at.computerId, at.id)}/message`, "POST", {
              text: `${message}\n\nFile: ${conversation.path} (${conversationPlace(conversation)})`,
              messageId: `u-${crypto.randomUUID()}`,
              attachmentIds: [],
            });
          }
        } catch (caught) {
          toast.error(destination.kind === "review-agent" ? "Couldn't send the reply to the review agent" : "Couldn't send the reply to your thread", { description: apiError(caught) });
          throw caught;
        }
        toast.success(reached(destination, "reply"));
        return;
      }
      await act("reply", { threadId: conversation.id, body: text, pending: action === "review" }, action === "review" ? "Couldn't add the reply to your review" : "Couldn't post the reply");
      if (action === "comment") toast.success("Your reply is on GitHub.");
      void refresh();
    },
    editComment: async (comment, body) => {
      await act("edit-comment", { commentId: comment.id, body }, "Couldn't save the comment");
      await refresh();
    },
    deleteComment: async (comment) => {
      await act("delete-comment", { commentId: comment.id }, "Couldn't delete the comment");
      await refresh();
    },
    addFinding: async (finding) => {
      const body = [`**${finding.title}**`, finding.body, finding.suggestion ? `\`\`\`suggestion\n${finding.suggestion}\n\`\`\`` : ""].filter(Boolean).join("\n\n");
      const posted = await pullRequestAction<{ id?: string | null }>(organizationId, pullRequest.workspaceId, pullRequest.number, "pending-comment", {
        path: finding.path, line: finding.endLine, side: finding.side,
        ...(finding.startLine < finding.endLine ? { startLine: finding.startLine, startSide: finding.side } : {}),
        body,
      }).catch((caught) => { toast.error("Couldn't add the finding to your review", { description: apiError(caught) }); throw caught; });
      void refresh();
      await markFinding(finding, "added-to-github", posted?.id ?? undefined);
      toast.success("It's in your pending review.");
    },
    dismissFinding: async (finding) => {
      await markFinding(finding, "dismissed");
      toast("Finding dismissed.", { action: { label: "Undo", onClick: () => void markFinding(finding, "open").catch(() => undefined) } });
    },
    flagFinding: async (finding, words, reference) => {
      if (!reviewThread) return;
      try {
        await hubRequest(`${hubThreadPath(reviewThread.access.organizationId, reviewThread.computerId, reviewThread.id)}/message`, "POST", {
          text: flagFindingMessage(finding, words),
          messageId: `u-${crypto.randomUUID()}`,
          attachmentIds: [],
          codeReferences: [reference],
        });
      } catch (caught) {
        toast.error("Couldn't send your flag to the review agent", { description: apiError(caught) });
        throw caught;
      }
      toast.success("The review agent has your flag.");
    },
    focusedFinding: highlighted,
  }), [review?.viewer, pullRequest.repository, pullRequest.workspaceId, pullRequest.number, organizationId, destinations, pending, onOpenThread, onOpenLink, openReply, sendToThread, act, refresh, markFinding, reviewThread, highlighted]);

  const composer = selection ? (
    <LineCommentBox
      key={`${selection.path}:${selection.hunk}:${selection.anchor}`}
      viewer={review?.viewer}
      destinations={destinations}
      pending={pending}
      onOpenThread={onOpenThread}
      onCancel={() => setSelection(undefined)}
      onSubmit={submitSelection}
    />
  ) : undefined;

  const threadsByPath = useMemo(() => {
    const map = new Map<string, ReviewThread[]>();
    for (const entry of review?.threads ?? []) map.set(entry.path, [...(map.get(entry.path) ?? []), entry]);
    return map;
  }, [review?.threads]);

  const findingsByPath = useMemo(() => {
    const map = new Map<string, ReviewFinding[]>();
    for (const finding of agentReview?.findings ?? []) map.set(finding.path, [...(map.get(finding.path) ?? []), finding]);
    return map;
  }, [agentReview?.findings]);

  // The pane asked for a finding: open its file, draw its hunk, and bring it
  // into view once it is on the page.
  useEffect(() => {
    if (!focusFinding || !files?.length) return;
    const finding = agentReviewRef.current?.findings.find((entry) => entry.id === focusFinding.id);
    const index = finding ? files.findIndex((file) => file.path === finding.path) : -1;
    if (index < 0) return;
    onOpenChange(index, true);
    let frames = 0;
    let timer = 0;
    const find = () => {
      const element = document.getElementById(`review-finding-${focusFinding.id}`);
      if (element) { element.scrollIntoView({ block: "center" }); return; }
      if (frames++ === 0) document.getElementById(fileId(index))?.scrollIntoView({ block: "start" });
      if (frames < 30) timer = window.requestAnimationFrame(find);
    };
    timer = window.requestAnimationFrame(find);
    return () => window.cancelAnimationFrame(timer);
  }, [focusFinding, files, onOpenChange]);

  const queued = queuedComments(review);
  const submitReview = useCallback(async (event: string, body: string) => {
    await pullRequestAction(organizationId, pullRequest.workspaceId, pullRequest.number, "submit-review", { event, body });
    await refresh();
  }, [organizationId, pullRequest.workspaceId, pullRequest.number, refresh]);

  const finish = toolbar ? createPortal(
    <FinishReview queued={queued} own={isOwnPullRequest(review)} onSubmit={submitReview} />,
    toolbar,
  ) : null;

  if (error) {
    return (
      <>
        {finish}
        <div className="p-3"><PullRequestCommits picker organizationId={organizationId} repository={pullRequest.repository} number={pullRequest.number} revision={pullRequest.updatedAt} selected={selectedCommits} onChange={onSelectedCommitsChange} /></div>
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FileDiff /></EmptyMedia>
            <EmptyTitle>Files didn't load</EmptyTitle>
            <EmptyDescription>{error}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="outline" size="sm" onClick={retry}><RefreshCw data-icon="inline-start" />Try again</Button>
            <Button asChild variant="ghost" size="sm"><a href={`${pullRequest.url}/files`} target="_blank" rel="noreferrer" data-link>Open on GitHub</a></Button>
          </EmptyContent>
        </Empty>
      </>
    );
  }

  const count = files?.length ?? pullRequest.changedFiles ?? 0;
  const readCount = files?.filter((file) => isViewed(review, file.path)).length ?? 0;
  const canMarkRead = Boolean(review) && !selectedCommits.length;

  const fileList = (
            <div className="flex flex-col gap-0.5 px-2.5 py-3.5">
              <div className="flex items-center gap-2 px-2 pb-2">
                <h2 className="min-w-0 flex-1 text-xs leading-4 font-semibold text-foreground tabular-nums">
                  {count.toLocaleString()} {count === 1 ? "file" : "files"}
                </h2>
                {review && !selectedCommits.length && <span className="shrink-0 text-[11px] leading-4 text-muted-foreground tabular-nums">{readCount.toLocaleString()} read</span>}
              </div>
              {files ? files.map((file, index) => {
                const name = file.path.split("/").at(-1) ?? file.path;
                const viewed = !selectedCommits.length && isViewed(review, file.path);
                return (
                  <div
                    key={`${file.path}:${index}`}
                    data-slot="pull-request-file-row"
                    data-current={index === current || undefined}
                    className={cn("flex h-9 min-w-0 shrink-0 items-center gap-2 rounded-[7px] px-2", index === current ? "bg-accent" : "hover:bg-accent/50")}
                  >
                    <MarkRead compact path={file.path} viewed={viewed} disabled={!canMarkRead} onChange={(next) => onViewedChange(file.path, next)} />
                    <button
                      type="button"
                      data-link
                      className={cn(
                        "min-w-0 flex-1 truncate text-left font-mono text-[11px] leading-4 outline-none focus-visible:underline",
                        viewed ? "text-muted-foreground/60" : index === current ? "text-foreground" : "text-foreground/70",
                      )}
                      title={file.path}
                      aria-label={`Open file ${file.path}${file.commitSha ? ` at ${file.commitSha.slice(0, 7)}` : ""}`}
                      aria-current={index === current ? "true" : undefined}
                      onClick={() => { goTo(index, { reveal: true }); selectedFileElement.current = viewport.current?.querySelector<HTMLElement>(`[id="${fileId(index)}"]`)?.querySelector<HTMLElement>("[data-file-index]") ?? null; setFilesOpen(false); }}
                    >
                      {name}
                    </button>
                    <Totals additions={file.additions} deletions={file.deletions} className="text-[10px] leading-[14px]" />
                  </div>
                );
              }) : Array.from({ length: Math.min(12, pullRequest.changedFiles || 6) }, (_, index) => <Skeleton key={index} className="mx-2 my-2 h-5" />)}
            </div>
  );

  return (
    <ReviewSurfaceContext.Provider value={surface}>
      <div className="@container/files flex min-h-0 min-w-0 flex-1 flex-col">
      {finish}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Popover open={filesOpen} onOpenChange={next => { if (next) selectedFileElement.current = null; setFilesOpen(next); }}>
          <PopoverTrigger render={<Button variant="outline" size="sm" className="@min-[900px]/files:hidden" />} aria-label="Show changed files"><List /><span>{count} files</span></PopoverTrigger>
          <PopoverContent aria-label="Changed files" className="w-[min(22rem,calc(100vw-2rem))] overflow-y-auto" finalFocus={() => selectedFileElement.current ?? true}>
            <PopoverTitle className="sr-only">Changed files</PopoverTitle>
            {fileList}
          </PopoverContent>
        </Popover>
        <PullRequestCommits picker organizationId={organizationId} repository={pullRequest.repository} number={pullRequest.number} revision={pullRequest.updatedAt} selected={selectedCommits} onChange={onSelectedCommitsChange} />
        {selectedCommits.length > 0 && <span className="text-xs text-muted-foreground">Each commit shows its own changes. Select all commits to comment on the PR diff.</span>}
      </div>
      <div data-slot="pull-request-files" className="flex min-h-0 min-w-0 flex-1">
        <aside aria-label="Changed files" className="hidden w-[272px] shrink-0 border-r border-border @min-[900px]/files:block">
          <ScrollArea className="h-full">
            {fileList}
          </ScrollArea>
        </aside>
        <div ref={viewport} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1" viewportProps={{ tabIndex: 0, "aria-label": "Diffs" }}>
            <div className="flex flex-col pb-16">
              {reviewError && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
                  <span className="min-w-0">{reviewError}</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => void refresh()}><RefreshCw data-icon="inline-start" />Try again</Button>
                </div>
              )}
              {read?.truncated && (
                <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
                  GitHub lists the first 3,000 files. <a href={`${pullRequest.url}/files`} target="_blank" rel="noreferrer" data-link className="underline underline-offset-2 hover:text-foreground">Open on GitHub</a> for the rest.
                </p>
              )}
              {!files ? (
                Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="m-4 h-40 rounded-lg" />)
              ) : files.length === 0 ? (
                <Empty className="min-h-60">
                  <EmptyHeader><EmptyTitle>No changed files</EmptyTitle><EmptyDescription>This pull request has no file changes.</EmptyDescription></EmptyHeader>
                </Empty>
              ) : files.map((file, index) => (
                <div key={`${file.commitSha ?? "all"}:${file.path}:${index}`}>
                {file.commitSha && <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground break-words"><span className="font-mono">{file.commitSha.slice(0, 7)}</span> · {file.commitTitle}</p>}
                <FileDiffView
                  key={`${file.path}:${index}`}
                  file={file}
                  index={index}
                  open={open.has(index)}
                  viewed={!selectedCommits.length && isViewed(review, file.path)}
                  canMarkRead={canMarkRead && !selectedCommits.length}
                  onOpenChange={onOpenChange}
                  onViewedChange={onViewedChange}
                  url={pullRequest.url}
                  threads={selectedCommits.length ? NO_THREADS : threadsByPath.get(file.path) ?? NO_THREADS}
                  findings={selectedCommits.length ? NO_FINDINGS : findingsByPath.get(file.path) ?? NO_FINDINGS}
                  focusedFinding={focusFinding?.id}
                  selection={selection?.path === file.path ? selection : undefined}
                  onSelect={onSelect}
                  composer={selection?.path === file.path ? composer : undefined}
                />
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>
      </div>
    </ReviewSurfaceContext.Provider>
  );
}

const NO_THREADS: ReviewThread[] = [];
const NO_FINDINGS: ReviewFinding[] = [];
