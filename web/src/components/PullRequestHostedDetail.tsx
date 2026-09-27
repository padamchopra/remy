import { lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import type { HubThread } from "@remy/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu-base";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs-base";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip-base";
import { Deferred } from "@/components/Deferred";
import { Markdown } from "@/components/Markdown";
import { PaneHeader } from "@/components/PaneHeader";
import { pullRequestAction, RequestReviewers, ReviewerInitials, SquashAndMerge } from "@/components/PullRequestHostedActions";
import { LinkedThreadChip, ThreadDot } from "@/components/PullRequestLinkedThread";
import { PullRequestStackEntry, PullRequestStackRows, stackEntriesInOrder } from "@/components/PullRequestStack";
import { LinkedTicketChip } from "@/components/PullRequestLinkedTicket";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { ReviewAgentHeaderButton } from "@/components/ReviewAgentHeader";
import type { ReviewTarget } from "@/components/ReviewAgentStart";
import type { ReviewPaneView } from "@/components/ReviewAgentPane";
import { useIsMobile } from "@/hooks/use-mobile";
import { forgetThreadStart, useThreadStarts } from "@/lib/hub-thread-start";
import { rememberReviewPane, reviewPaneOpen, type ReviewFinding } from "@/lib/review-agent";
import { usePullRequestReview, useReviewRules } from "@/lib/review-agent-data";
import { apiError } from "@/lib/api-error";
import { useAccountResources } from "@/lib/hub-account-resources";
import { hubRequest, hubThreadBase, hubThreadPath } from "@/lib/hub-threads";
import {
  checkDuration,
  failingChecksMessage,
  mergeBlocker,
  openedLine,
  type PullRequestDetail,
  type PullRequestDetailCheck,
  type PullRequestDetailReviewer,
} from "@/lib/pull-request-detail";
import { linkedPullRequestThread } from "@/lib/pull-request-linked-thread";
import { unseenActivity } from "@/lib/pull-request-activity";
import { usePullRequestActivity, usePullRequestTicket } from "@/lib/pull-request-activity-data";
import type { PullRequestTileWorkspace } from "@/lib/pull-request-workspace";
import type { PullRequestView } from "@/lib/route";
import { cn } from "@/lib/utils";
import type { AuthoredPullRequest } from "@/components/PullRequests";

// The diff is its own surface: nobody reading the summary downloads it.
const PullRequestHostedFiles = lazy(() => import("@/components/PullRequestHostedFiles").then((module) => ({ default: module.PullRequestHostedFiles })));
// So is the timeline; only its badge's count is read before it opens.
const PullRequestHostedActivity = lazy(() => import("@/components/PullRequestHostedActivity").then((module) => ({ default: module.PullRequestHostedActivity })));
// The review agent pane arrives the first time it opens.
const ReviewAgentPane = lazy(() => import("@/components/ReviewAgentPane").then((module) => ({ default: module.ReviewAgentPane })));

/// A private repository's attachments load only from the signed copies GitHub
/// renders for this reader. They expire within minutes, so they are read when
/// the pull request opens; until they arrive, or if they never do, the written
/// address stands and a failed image falls back to its alt text.
function useSignedImages(organizationId: string, repository: string, number: number) {
  const [images, setImages] = useState<Record<string, string>>();
  useEffect(() => {
    let current = true;
    setImages(undefined);
    if (!organizationId) return;
    const params = new URLSearchParams({ repository, number: String(number) });
    hubRequest<{ images?: Record<string, string> }>(`${hubThreadBase(organizationId)}/github/pull-request-images?${params}`)
      .then((response) => { if (current) setImages(response.images ?? {}); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [organizationId, repository, number]);
  return images;
}

/// What the list leaves out — mergeability, check times, reviewer names —
/// read when the pull request opens and again after anything changes it. A
/// hub without the route leaves it undefined and the summary draws from the
/// list alone.
function usePullRequestDetail(organizationId: string, repository: string, number: number, revision: string) {
  const [detail, setDetail] = useState<PullRequestDetail>();
  useEffect(() => {
    let current = true;
    if (!organizationId) return;
    const params = new URLSearchParams({ repository, number: String(number) });
    hubRequest<PullRequestDetail>(`${hubThreadBase(organizationId)}/github/pull-request?${params}`)
      .then((response) => { if (current) setDetail(response); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [organizationId, repository, number, revision]);
  return detail;
}

function githubPullRequestNumber(href: string, repository: string): number | undefined {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|issues)\/(\d+)\/?(?:[?#].*)?$/i.exec(href);
  if (!match || match[1]!.toLowerCase() !== repository.toLowerCase()) return undefined;
  return Number(match[2]);
}

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("Couldn't copy to the clipboard");
  }
}

const STATE_PILL = "h-[22px] gap-1.5 rounded-[6px] px-[9px] text-[11px] leading-[14px] font-medium [&>svg]:size-3";

function StatePill({ state, isDraft }: { state?: string; isDraft: boolean }) {
  const [label, Icon, tone] = state === "MERGED"
    ? ["Merged", GitMerge, "bg-violet-500/15 text-violet-700 dark:text-violet-300"] as const
    : state === "CLOSED"
      ? ["Closed", GitPullRequestClosed, "bg-error/14 text-error-foreground"] as const
      : isDraft
        ? ["Draft", GitPullRequestDraft, "bg-muted text-muted-foreground"] as const
        : ["Open", GitPullRequest, "bg-success/14 text-success-foreground"] as const;
  return (
    <span data-slot="pull-request-state" className={cn("inline-flex shrink-0 items-center", STATE_PILL, tone)}>
      <Icon aria-hidden />
      {label}
    </span>
  );
}

function DiffTotals({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] leading-4 tabular-nums" aria-label={`${additions} additions, ${deletions} deletions`}>
      <span className="text-success-foreground">+{additions.toLocaleString()}</span>
      <span className="text-destructive">−{deletions.toLocaleString()}</span>
    </span>
  );
}

function BranchChip({ name }: { name: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <button
            type="button"
            onClick={() => void copy(name, "Branch name copied.")}
            aria-label={`${name}, copy branch name`}
            className="flex h-5 min-w-0 items-center rounded-[5px] bg-muted px-[7px] font-mono text-[11px] leading-[14px] text-foreground/75 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        )}
      >
        <span className="truncate">{name}</span>
      </TooltipTrigger>
      <TooltipContent>Copy branch name</TooltipContent>
    </Tooltip>
  );
}

function RailSection({ title, detail, children }: { title: string; detail?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex shrink-0 flex-col gap-[9px] px-0.5">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 flex-1 text-[11px] leading-4 font-semibold tracking-[0.025em] text-muted-foreground uppercase">{title}</h2>
        {detail}
      </div>
      {children}
    </section>
  );
}

const REVIEWER_STATE: Record<PullRequestDetailReviewer["state"], { label: string; className: string }> = {
  APPROVED: { label: "Approved", className: "text-success-foreground" },
  CHANGES_REQUESTED: { label: "Changes requested", className: "text-destructive" },
  COMMENTED: { label: "Commented", className: "text-muted-foreground" },
  DISMISSED: { label: "Dismissed", className: "text-muted-foreground" },
  REQUESTED: { label: "Waiting", className: "text-muted-foreground" },
};

function Reviewers({ reviewers, request }: { reviewers: PullRequestDetailReviewer[]; request: ReactNode }) {
  return (
    <RailSection title="Reviewers" detail={request}>
      {reviewers.length === 0 ? (
        <p className="text-xs leading-[18px] text-muted-foreground">Nobody is asked to review yet.</p>
      ) : (
        <ul className="flex flex-col gap-[9px]">
          {reviewers.map((reviewer) => {
            const state = REVIEWER_STATE[reviewer.state] ?? REVIEWER_STATE.REQUESTED;
            const name = reviewer.name || reviewer.login;
            return (
              <li key={reviewer.login} className="flex min-w-0 items-center gap-[9px]">
                <ReviewerInitials name={name} />
                <a
                  href={`https://github.com/${encodeURIComponent(reviewer.login)}`}
                  target="_blank"
                  rel="noreferrer"
                  data-link
                  title={reviewer.name ? reviewer.login : undefined}
                  className="min-w-0 flex-1 truncate text-xs leading-[18px] text-foreground hover:underline"
                >
                  {name}
                </a>
                <span className={cn("shrink-0 text-[11px] leading-4", state.className)}>{state.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </RailSection>
  );
}

function CheckIcon({ state }: { state: PullRequestDetailCheck["state"] }) {
  if (state === "fail") return <CircleX aria-label="Failed" className="size-3.5 shrink-0 text-destructive" />;
  if (state === "pending") return <CircleDashed aria-label="Running" className="size-3.5 shrink-0 text-muted-foreground" />;
  if (state === "skipping") return <CircleDashed aria-label="Skipped" className="size-3.5 shrink-0 text-muted-foreground/60" />;
  return <CircleCheck aria-label="Passed" className="size-3.5 shrink-0 text-success-foreground" />;
}

/// Failing first, then running, passing and skipped, the way a person reads them.
const CHECK_ORDER: Record<PullRequestDetailCheck["state"], number> = { fail: 0, pending: 1, pass: 2, skipping: 3 };

function Checks({ checks }: { checks: PullRequestDetailCheck[] }) {
  const passed = checks.filter((check) => check.state === "pass" || check.state === "skipping").length;
  const ordered = [...checks].sort((left, right) => CHECK_ORDER[left.state] - CHECK_ORDER[right.state]);
  return (
    <RailSection
      title="Checks"
      detail={checks.length ? <span className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">{passed}/{checks.length}</span> : undefined}
    >
      {checks.length === 0 ? (
        <p className="text-xs leading-[18px] text-muted-foreground">No checks yet.</p>
      ) : (
        <ul className="flex flex-col gap-[9px]">
          {ordered.map((check, index) => {
            const name = (
              <span className={cn("min-w-0 flex-1 truncate text-xs leading-[18px]", check.state === "fail" ? "text-foreground" : "text-foreground/75")}>
                {check.name}
              </span>
            );
            return (
              <li key={`${check.name}:${index}`} className="flex min-w-0 items-center gap-[9px]" title={check.summary ?? undefined}>
                <CheckIcon state={check.state} />
                {check.url ? (
                  <a href={check.url} target="_blank" rel="noreferrer" data-link className="flex min-w-0 flex-1 hover:underline">{name}</a>
                ) : name}
                <span className="shrink-0 font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">{checkDuration(check.startedAt, check.completedAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </RailSection>
  );
}

/// Shown only when checks fail and a thread is working on the branch: the
/// failures go to that thread in one message.
function FailingChecks({
  pullRequest,
  checks,
  thread,
  onOpenThread,
}: {
  pullRequest: AuthoredPullRequest;
  checks: PullRequestDetailCheck[];
  thread: HubThread;
  onOpenThread: () => void;
}) {
  const [sending, setSending] = useState(false);
  const failing = checks.filter((check) => check.state === "fail").length;
  const send = async () => {
    setSending(true);
    try {
      await hubRequest(`${hubThreadPath(thread.access.organizationId, thread.computerId, thread.id)}/message`, "POST", {
        text: failingChecksMessage(pullRequest, checks),
        messageId: `u-${crypto.randomUUID()}`,
        attachmentIds: [],
      });
      toast.success("Your thread has the failing checks.");
    } catch (caught) {
      toast.error("Couldn't send the failing checks", { description: apiError(caught) });
    } finally {
      setSending(false);
    }
  };
  return (
    <section aria-label="Failing checks" data-slot="pull-request-failing-checks" className="flex shrink-0 flex-col gap-2.5 rounded-[10px] border border-border p-3">
      <h2 className="text-xs leading-4 font-semibold text-foreground">
        {failing === 1 ? "1 check is failing" : `${failing} checks are failing`}
      </h2>
      <LinkedThreadChip thread={thread} onOpen={onOpenThread} />
      <Button type="button" disabled={sending} onClick={() => void send()} className="h-8 w-full rounded-[9px] text-xs font-semibold">
        {sending && <Spinner data-icon="inline-start" />}
        Ask the thread to fix them
      </Button>
    </section>
  );
}

/// The description reads as Paper draws it: muted body text, and a bullet list
/// marked with em dashes rather than dots.
const DESCRIPTION = cn(
  "gap-2.5 text-[13px] leading-[21px] text-foreground/75",
  "[&_:is(h1,h2,h3,h4,strong)]:text-foreground",
  "[&_ul:not(.contains-task-list)]:list-none [&_ul:not(.contains-task-list)]:gap-[5px] [&_ul:not(.contains-task-list)]:pl-0",
  "[&_ul:not(.contains-task-list)>li]:relative [&_ul:not(.contains-task-list)>li]:pl-[22px]",
  "[&_ul:not(.contains-task-list)>li]:before:absolute [&_ul:not(.contains-task-list)>li]:before:left-0 [&_ul:not(.contains-task-list)>li]:before:text-muted-foreground/60 [&_ul:not(.contains-task-list)>li]:before:content-['—']",
);

const TAB = "h-[37px] gap-[7px] rounded-none border-b-2 border-transparent px-3 py-0 text-xs leading-4 text-muted-foreground data-active:border-foreground data-active:bg-transparent data-active:font-semibold data-active:text-foreground";

export function PullRequestHostedDetail({
  pullRequest,
  organizationId,
  workspace,
  threads,
  canOpen,
  onOpen,
  onOpenThread,
  onOpenWorkspace,
  onChanged,
  view,
  onViewChange,
  onBack,
  stackPullRequest,
}: {
  pullRequest: AuthoredPullRequest;
  organizationId: string;
  /// The workspace as the sidebar draws it, for the header chip.
  workspace: { workspace: PullRequestTileWorkspace; name: string; organizationId?: string };
  threads: HubThread[];
  canOpen: (number: number) => boolean;
  onOpen: (number: number) => void;
  onOpenThread: (thread: HubThread) => void;
  onOpenWorkspace?: (organizationId: string, workspaceId: string) => void;
  /// Something here changed the pull request; the list reads GitHub again.
  onChanged: () => void;
  view?: PullRequestView;
  onViewChange: (view?: PullRequestView) => void;
  onBack: () => void;
  /// Another pull request of this list by number, for a stack note's Review #n too.
  stackPullRequest?: (number: number) => AuthoredPullRequest | undefined;
}) {
  const [revision, setRevision] = useState(0);
  const [filesToolbar, setFilesToolbar] = useState<HTMLDivElement | null>(null);
  const images = useSignedImages(organizationId, pullRequest.repository, pullRequest.number);
  const detail = usePullRequestDetail(organizationId, pullRequest.repository, pullRequest.number, `${pullRequest.updatedAt}:${revision}`);
  const changed = useCallback(() => { setRevision((value) => value + 1); onChanged(); }, [onChanged]);
  const timeline = usePullRequestActivity(organizationId, pullRequest.repository, pullRequest.number, `${pullRequest.updatedAt}:${revision}`);
  const ticket = usePullRequestTicket(organizationId, pullRequest.repository, pullRequest.number);
  const unseen = unseenActivity(timeline.activity);
  const { markSeen } = timeline;
  // Opening Activity, or new activity arriving while it is open, is seeing it.
  useEffect(() => {
    if (view === "activity" && unseen > 0) markSeen();
  }, [view, unseen, markSeen]);

  const candidates = useMemo(
    () => threads.filter((thread) => thread.detail.branch === pullRequest.headRefName),
    [threads, pullRequest.headRefName],
  );
  const accounts = useMemo(
    () => [...new Set(candidates.map((thread) => thread.access.organizationId || organizationId))].sort(),
    [candidates, organizationId],
  );
  const resources = useAccountResources(accounts);
  const computers = useMemo(() => accounts.flatMap((id) => resources[id]?.computers ?? []), [accounts, resources]);
  // Your review agent: its review, its thread, a start still on its way, and the pane.
  const { review, setReview, reload: reloadReview } = usePullRequestReview(organizationId, pullRequest.repository, pullRequest.number);
  const reviewThread = review ? threads.find((entry) => entry.id === review.threadId && entry.computerId === review.computerId) : undefined;
  const starts = useThreadStarts();
  const start = useMemo(() => starts.filter((entry) =>
    entry.organizationId === organizationId && entry.review
    && entry.review.repository.toLowerCase() === pullRequest.repository.toLowerCase()
    && entry.review.number === pullRequest.number).at(-1), [starts, organizationId, pullRequest.repository, pullRequest.number]);
  const starting = review ? undefined : start;
  useEffect(() => {
    if (start && review && start.created?.id === review.threadId) forgetThreadStart(start.requestId);
  }, [start, review]);
  // A start that is through reads the review it made, in case its frame came first.
  useEffect(() => { if (start?.phase === "ready") void reloadReview(); }, [start?.phase, reloadReview]);
  const phone = useIsMobile();
  const [desktopPane, setDesktopPane] = useState(() => reviewPaneOpen(pullRequest.repository, pullRequest.number));
  const [phonePane, setPhonePane] = useState(false);
  const [paneView, setPaneView] = useState<ReviewPaneView>("review");
  const reviewing = Boolean(review || starting);
  const paneShown = phone ? phonePane : desktopPane && (reviewing || paneView === "rules");
  const showPane = (open: boolean, view: ReviewPaneView = "review") => {
    setPaneView(view);
    if (phone) { setPhonePane(open); return; }
    setDesktopPane(open);
    rememberReviewPane(pullRequest.repository, pullRequest.number, open);
  };
  const rules = useReviewRules(organizationId, pullRequest.repository, reviewing || paneShown);
  const [focusFinding, setFocusFinding] = useState<{ id: string; at: number }>();
  const showFinding = useCallback((finding: ReviewFinding) => {
    setFocusFinding({ id: finding.id, at: Date.now() });
    if (view !== "files") onViewChange("files");
    if (phone) setPhonePane(false);
  }, [view, onViewChange, phone]);
  const reviewTarget = (entry: AuthoredPullRequest): ReviewTarget => ({
    organizationId, workspaceId: entry.workspaceId, repository: entry.repository, number: entry.number,
    title: entry.title, headRefName: entry.headRefName, baseRefName: entry.baseRefName,
  });

  const thread = linkedPullRequestThread(pullRequest, candidates, computers, (entry) => entry.id === review?.threadId);

  const checks: PullRequestDetailCheck[] = detail?.checks ?? pullRequest.checks;
  const reviewers: PullRequestDetailReviewer[] = detail?.reviewers ?? pullRequest.reviewers ?? [];
  const state = detail?.state ?? pullRequest.state;
  const isDraft = detail?.isDraft ?? pullRequest.isDraft;
  const open = !state || state === "OPEN";
  const failing = checks.some((check) => check.state === "fail");
  const workspaceOrganization = workspace.organizationId ?? organizationId;
  const label = `${workspace.name} #${pullRequest.number}`;

  // A reference to a pull request Remy has opens here; anything else is GitHub's.
  const openLink = useCallback((href: string) => {
    const number = githubPullRequestNumber(href, pullRequest.repository);
    if (number && number !== pullRequest.number && canOpen(number)) onOpen(number);
    else window.open(href, "_blank", "noopener,noreferrer");
  }, [canOpen, onOpen, pullRequest.number, pullRequest.repository]);

  const changeDraft = async (next: "ready" | "draft") => {
    try {
      await pullRequestAction(organizationId, pullRequest.workspaceId, pullRequest.number, next);
      toast.success(next === "ready" ? "It's ready for review." : "It's a draft again.");
      changed();
    } catch (caught) {
      toast.error(next === "ready" ? "Couldn't mark it ready for review" : "Couldn't convert it to a draft", { description: apiError(caught) });
    }
  };

  const stack = pullRequest.stack;
  const conflicts = new Map((detail?.stack ?? []).map((entry) => [entry.number, entry.mergeable]));

  return (
    <TooltipProvider>
      <div data-slot="pull-request-with-review" className="flex min-h-0 min-w-0 flex-1">
      <main className={cn("flex min-h-0 min-w-0 flex-1 flex-col", phone && paneShown && "hidden")}>
        <PaneHeader sidebar crumbs={[{ label: "Pull requests", onClick: onBack }, { label }]}>
          <div className="flex shrink-0 items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              data-link
              disabled={!onOpenWorkspace}
              onClick={() => onOpenWorkspace?.(workspaceOrganization, pullRequest.workspaceId)}
              className="h-7 max-w-44 gap-[7px] rounded-lg bg-transparent px-2.5 text-xs font-[450] shadow-none max-sm:hidden dark:bg-transparent"
            >
              <WorkspaceMark home={false} workspace={workspace.workspace} size="sm" organizationId={workspace.organizationId} />
              <span className="truncate">{workspace.name}</span>
            </Button>
            {thread && (
              <Button
                type="button"
                variant="secondary"
                data-link
                onClick={() => onOpenThread(thread)}
                aria-label={`Open thread: ${thread.detail.title || "Untitled thread"}`}
                className="h-7 gap-[7px] rounded-lg border border-input bg-accent px-2.5 text-xs font-[450]"
              >
                <ThreadDot state={thread.detail.state} />
                Open thread
              </Button>
            )}
            {open && (
              <ReviewAgentHeaderButton
                target={reviewTarget(pullRequest)}
                reviewing={reviewing}
                state={starting ? (starting.phase === "failed" ? "idle" : "working") : reviewThread?.detail.state}
                paneOpen={paneShown}
                rules={rules.rules}
                onTogglePane={() => showPane(!paneShown)}
                onViewRules={() => showPane(true, "rules")}
                onStarted={() => showPane(true)}
              />
            )}
            <Tooltip>
              <TooltipTrigger
                render={(
                  <a
                    href={pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    data-link
                    aria-label="Open on GitHub"
                    className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "size-7 rounded-lg text-muted-foreground")}
                  />
                )}
              >
                <ExternalLink className="size-[15px]" />
              </TooltipTrigger>
              <TooltipContent align="end">Open on GitHub</TooltipContent>
            </Tooltip>
            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" className="size-7 rounded-lg text-muted-foreground" />}>
                <MoreHorizontal className="size-[15px]" />
              </MenuTrigger>
              <MenuContent align="end" className="w-52">
                <MenuItem onClick={() => void copy(window.location.href, "Link copied.")}>Copy link</MenuItem>
                <MenuItem onClick={() => void copy(pullRequest.headRefName, "Branch name copied.")}>Copy branch name</MenuItem>
                {open && (
                  <>
                    <MenuSeparator />
                    {isDraft
                      ? <MenuItem onClick={() => void changeDraft("ready")}>Mark ready for review</MenuItem>
                      : <MenuItem onClick={() => void changeDraft("draft")}>Convert to draft</MenuItem>}
                  </>
                )}
              </MenuContent>
            </Menu>
          </div>
        </PaneHeader>
        <Tabs
          value={view ?? "summary"}
          onValueChange={(value) => onViewChange(value === "files" || value === "activity" ? value : undefined)}
          className="min-h-0 flex-1 gap-0"
        >
          <header data-slot="pull-request-header" className="flex shrink-0 flex-col gap-2.5 px-4 pt-[22px] sm:px-7">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs leading-4 text-muted-foreground">
              <StatePill state={state} isDraft={isDraft} />
              <span className="shrink-0 font-mono">{label}</span>
              <span aria-hidden className="text-muted-foreground/50 max-sm:hidden">·</span>
              <span className="min-w-0">{openedLine(pullRequest, detail)}</span>
            </div>
            <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-balance wrap-break-word text-foreground">{pullRequest.title}</h1>
            <div className="flex min-w-0 flex-wrap items-center gap-2 pb-1">
              <BranchChip name={pullRequest.headRefName} />
              <ArrowRight aria-label="into" className="size-3.5 shrink-0 text-muted-foreground" />
              <BranchChip name={pullRequest.baseRefName} />
              <span aria-hidden className="text-xs text-muted-foreground/50 max-sm:hidden">·</span>
              <button
                type="button"
                data-link
                onClick={() => onViewChange("files")}
                className="inline-flex items-center gap-2 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <DiffTotals additions={pullRequest.additions} deletions={pullRequest.deletions} />
                {pullRequest.changedFiles ? (
                  <span className="text-[11px] leading-4 text-muted-foreground">
                    across {pullRequest.changedFiles.toLocaleString()} {pullRequest.changedFiles === 1 ? "file" : "files"}
                  </span>
                ) : null}
              </button>
            </div>
          </header>
          <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 sm:px-7">
            <TabsList aria-label="Pull request" className="-mb-px h-[38px] items-end gap-0.5">
              <TabsTrigger value="summary" className={TAB}>Summary</TabsTrigger>
              <TabsTrigger value="files" className={TAB}>
                Files
                {pullRequest.changedFiles ? <span className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">{pullRequest.changedFiles.toLocaleString()}</span> : null}
              </TabsTrigger>
              <TabsTrigger value="activity" className={TAB}>
                Activity
                {unseen > 0 && (
                  <span
                    data-slot="pull-request-activity-unseen"
                    aria-label={`${unseen} new`}
                    className="flex h-[15px] min-w-4 items-center justify-center rounded-[4px] bg-primary/20 px-1 text-[10px] leading-3 font-semibold text-info-foreground tabular-nums"
                  >
                    {unseen}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
            {/* The Files tab puts Finish review here, beside the tab it belongs to. */}
            <div ref={setFilesToolbar} data-slot="pull-request-files-toolbar" className={cn("ml-auto flex shrink-0 items-center", view !== "files" && "hidden")} />
          </div>
          <TabsContent value="summary" keepMounted className="flex min-h-0 flex-1 data-hidden:hidden">
            <ScrollArea data-slot="pull-request-detail-body" className="min-h-0 min-w-0 flex-1" viewportProps={{ tabIndex: 0, "aria-label": "Pull request summary" }}>
              <div className="flex flex-col gap-8 px-4 pt-6 pb-16 sm:px-7 lg:flex-row">
                <div className="flex min-w-0 flex-1 flex-col gap-6">
                  <section aria-labelledby="pull-request-description" data-slot="pull-request-description" className="flex shrink-0 flex-col gap-2.5">
                    <h2 id="pull-request-description" className="text-[13px] leading-[18px] font-semibold text-foreground">Description</h2>
                    {pullRequest.body?.trim()
                      ? <Markdown text={pullRequest.body} images={images} repository={pullRequest.repository} onOpenLink={openLink} className={DESCRIPTION} />
                      : <p className="text-[13px] leading-[21px] text-muted-foreground">No description.</p>}
                    {ticket && <LinkedTicketChip ticket={ticket} />}
                  </section>
                  {stack?.entries && stack.entries.length > 1 && (
                    <section aria-label={`Stack #${stack.number}`} data-slot="pull-request-stack" className="flex shrink-0 flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <h2 className="min-w-0 flex-1 text-[13px] leading-[18px] font-semibold text-foreground">Stack</h2>
                        <span className="shrink-0 text-[11px] leading-4 text-muted-foreground">{stack.position} of {stack.size} · merge in order</span>
                      </div>
                      <PullRequestStackRows>
                        {stackEntriesInOrder(stack.entries).map((entry) => (
                          <PullRequestStackEntry
                            key={entry.number}
                            repository={pullRequest.repository}
                            entry={entry}
                            current={entry.number === pullRequest.number}
                            mergeable={conflicts.get(entry.number)}
                            canOpen={canOpen}
                            onOpen={onOpen}
                          />
                        ))}
                      </PullRequestStackRows>
                    </section>
                  )}
                </div>
                <aside aria-label="Merge, reviewers and checks" className="flex shrink-0 flex-col gap-[18px] lg:w-[296px]">
                  {failing && thread && (
                    <FailingChecks pullRequest={pullRequest} checks={checks} thread={thread} onOpenThread={() => onOpenThread(thread)} />
                  )}
                  {open && (
                    <SquashAndMerge
                      organizationId={organizationId}
                      workspaceId={pullRequest.workspaceId}
                      pullRequest={pullRequest}
                      headRefOid={detail?.headRefOid}
                      blocker={mergeBlocker({ isDraft, state }, detail)}
                      onMerged={() => { onChanged(); onBack(); }}
                    />
                  )}
                  <Reviewers
                    reviewers={reviewers}
                    request={open ? (
                      <RequestReviewers
                        organizationId={organizationId}
                        workspaceId={pullRequest.workspaceId}
                        repository={pullRequest.repository}
                        number={pullRequest.number}
                        requested={reviewers.map((reviewer) => reviewer.login)}
                        onRequested={changed}
                      />
                    ) : undefined}
                  />
                  <Checks checks={checks} />
                </aside>
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="files" keepMounted className="flex min-h-0 flex-1 data-hidden:hidden">
            <Deferred open={view === "files"}>
              <PullRequestHostedFiles
                organizationId={organizationId}
                pullRequest={pullRequest}
                active={view === "files"}
                thread={thread}
                review={review}
                reviewThread={reviewThread}
                onReviewChanged={setReview}
                focusFinding={focusFinding}
                onOpenThread={onOpenThread}
                onOpenLink={openLink}
                toolbar={filesToolbar}
              />
            </Deferred>
          </TabsContent>
          <TabsContent value="activity" keepMounted className="flex min-h-0 flex-1 data-hidden:hidden">
            <Deferred open={view === "activity"}>
              <PullRequestHostedActivity
                organizationId={organizationId}
                pullRequest={pullRequest}
                activity={timeline.activity}
                failed={timeline.failed}
                thread={thread}
                active={view === "activity"}
                onOpenThread={onOpenThread}
                onOpenLink={openLink}
                onCommented={() => { timeline.reload(); changed(); }}
              />
            </Deferred>
          </TabsContent>
        </Tabs>
      </main>
      <Deferred open={paneShown} fallback={<div className={cn("shrink-0 border-l border-border bg-background", phone ? "w-full flex-1" : "w-[400px]")} />}>
        {/* Latched: hiding the pane keeps what you were writing to the agent. */}
        <div className={paneShown ? "contents" : "hidden"}>
          <ReviewAgentPane
            organizationId={organizationId}
            target={reviewTarget(pullRequest)}
            workspace={{
              name: workspace.name,
              smallMark: <WorkspaceMark home={false} workspace={workspace.workspace} size="sm" organizationId={workspace.organizationId} />,
            }}
            review={review}
            start={starting}
            thread={reviewThread}
            rules={rules.rules}
            view={paneView}
            onView={setPaneView}
            onClose={() => showPane(false)}
            phone={phone}
            headSha={detail?.headRefOid}
            commits={detail?.commits}
            stackTarget={(number) => { const entry = stackPullRequest?.(number); return entry ? reviewTarget(entry) : undefined; }}
            onOpenPullRequest={(number) => { if (canOpen(number)) onOpen(number); }}
            onOpenThread={onOpenThread}
            onFinding={showFinding}
            onReviewChanged={setReview}
            onStarted={(target) => {
              toast.success(`The review agent is reviewing #${target.number}.`, { action: canOpen(target.number) ? { label: "Open", onClick: () => onOpen(target.number) } : undefined });
            }}
            onRulesChanged={() => void rules.reload()}
          />
        </div>
      </Deferred>
      </div>
    </TooltipProvider>
  );
}
