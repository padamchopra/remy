import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Book, Bot, ChevronLeft, FileCode2, Flag, Layers, Loader2Icon, Monitor, MoreHorizontal, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cloudComputerName, CURSOR_CLOUD_COMPUTER_ID, type ComputerSummary, type HubThread } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu-base";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Segmented, SegmentedItem } from "@/components/ui/segmented-base";
import { Spinner } from "@/components/ui/spinner";
import { InputGroupText } from "@/components/ui/input-group";
import { Markdown } from "@/components/Markdown";
import { ModelPickerButton } from "@/components/ModelPicker";
import { ReplyComposer } from "@/components/ReplyComposer";
import { InlineImageComposer, type InlineImageComposerHandle, type InlineImageComposerValue } from "@/components/InlineImageComposer";
import { ThreadStartMarker } from "@/components/ThreadStartMarker";
import type { ModelAccessResponse } from "@/components/HubModelAccess";
import { ReviewAgentStartPopover } from "@/components/ReviewAgentHeader";
import type { ReviewTarget } from "@/components/ReviewAgentStart";
import { apiError } from "@/lib/api-error";
import { threadModelPicker } from "@/lib/hub-models";
import { useHubResource } from "@/lib/hub-organization";
import { watchHubComputers } from "@/lib/hub-computers";
import { hubRequest, HubRequestError, hubThreadPath } from "@/lib/hub-threads";
import { retryHubThread, type ThreadStart } from "@/lib/hub-thread-start";
import { modelLabel } from "@/lib/providers";
import {
  acceptRuleProposal,
  commitsSince,
  discardRuleProposal,
  findingLocation,
  hasNewCommits,
  parseFlagMessage,
  referenceChip,
  reviewControlMessage,
  reviewNewChanges,
  reviewStatus,
  stackDependencies,
  type ReviewFinding,
  type ReviewRule,
  type ReviewRuleProposal,
  type ReviewRuleScope,
  type ReviewState,
} from "@/lib/review-agent";
import type { ChatCodeReference } from "@/state/types";
import { cn } from "@/lib/utils";

// Rules are a second screen of the pane; nobody reading a review downloads them.
const ReviewAgentRules = lazy(() => import("@/components/ReviewAgentRules").then((module) => ({ default: module.ReviewAgentRules })));

export type ReviewPaneView = "review" | "rules";

const DOT: Record<ReviewFinding["severity"], string> = {
  must: "bg-destructive-foreground",
  should: "bg-warning-foreground",
  note: "bg-muted-foreground",
};

const OUTLINE = "h-7 rounded-lg border-input bg-transparent px-3 text-xs font-normal text-foreground/70 shadow-none hover:text-foreground dark:bg-transparent";
const PRIMARY = "h-7 rounded-lg px-3 text-xs font-semibold";

/// The pane's chip, from the review thread's own state: blue while it works,
/// amber when it waits for you, grey when it is done.
function StatusChip({ state }: { state: unknown }) {
  const status = reviewStatus(state);
  return (
    <span
      data-slot="review-agent-status"
      className={cn(
        "flex h-[17px] shrink-0 items-center rounded-[5px] px-1.5 text-[10px] leading-[13px] font-semibold",
        status === "Working" ? "bg-info/15 text-info-foreground" : status === "Needs you" ? "bg-warning/15 text-warning-foreground" : "bg-foreground/6 text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

/// The findings as a list in the pane. A row opens its place in the diff;
/// a dismissed one stays, struck through.
export function FindingsList({ findings, onFinding }: { findings: ReviewFinding[]; onFinding: (finding: ReviewFinding) => void }) {
  if (!findings.length) return <p className="text-xs leading-[18px] text-muted-foreground">No findings. Nothing in this change needs a look.</p>;
  return (
    <ul data-slot="review-findings" aria-label="Findings" className="flex flex-col overflow-hidden rounded-[10px] border border-border">
      {findings.map((finding) => {
        const quiet = finding.status === "dismissed" || finding.status === "resolved";
        return (
          <li key={finding.id} className="border-b border-border last:border-b-0">
            <button
              type="button"
              data-link
              onClick={() => onFinding(finding)}
              className="flex w-full min-w-0 items-center gap-2.5 px-3 py-2.5 text-left outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", quiet ? "bg-muted-foreground" : DOT[finding.severity])} />
              <span className={cn("min-w-0 flex-1 text-xs leading-4", quiet ? "text-foreground/70" : "text-foreground", finding.status === "dismissed" && "line-through decoration-1")}>
                {finding.title}
                {finding.status === "resolved" && <span className="ml-1.5 text-[11px] text-success-foreground no-underline">Fixed</span>}
                {finding.status === "added-to-github" && <span className="ml-1.5 text-[11px] text-muted-foreground">In your review</span>}
              </span>
              <span className={cn("w-[166px] shrink-0 truncate text-right font-mono text-[11px] leading-4", quiet ? "text-muted-foreground/60" : "text-muted-foreground")} title={`${finding.path}:${finding.startLine}`}>
                {findingLocation(finding)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/// Save this as a rule? The agent's wording, which you can change, and where
/// it applies. Nothing is a rule until Save rule.
export function ProposalCard({ organizationId, proposal, workspace, onDecided }: {
  organizationId: string;
  proposal: ReviewRuleProposal;
  workspace: { name: string; mark?: ReactNode };
  onDecided: (proposal: ReviewRuleProposal, rule?: ReviewRule) => void;
}) {
  const [text, setText] = useState(proposal.text);
  const [scope, setScope] = useState<ReviewRuleScope>(proposal.scope);
  const [busy, setBusy] = useState<"save" | "discard">();
  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy("save");
    try {
      const result = await acceptRuleProposal(organizationId, proposal.id, { text: text.trim(), scope });
      toast.success("Your rule is saved. It applies from the agent's next turn.");
      onDecided(result.proposal, result.rule);
    } catch (caught) {
      toast.error("Couldn't save the rule", { description: apiError(caught) });
    } finally {
      setBusy(undefined);
    }
  };
  const discard = async () => {
    if (busy) return;
    setBusy("discard");
    try {
      onDecided(await discardRuleProposal(organizationId, proposal.id));
    } catch (caught) {
      toast.error("Couldn't discard the rule", { description: apiError(caught) });
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <section aria-label="Save this as a rule?" data-slot="review-rule-proposal" className="flex shrink-0 flex-col gap-3 rounded-xl border border-input bg-card p-3.5">
      <h3 className="flex items-center gap-2 text-xs leading-4 font-semibold text-foreground">
        <Book aria-hidden className="size-[13px] shrink-0 text-foreground/70" />
        Save this as a rule?
      </h3>
      <textarea
        aria-label="Rule"
        value={text}
        maxLength={500}
        disabled={Boolean(busy)}
        onChange={(change) => setText(change.target.value)}
        onKeyDown={(key) => { if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) { key.preventDefault(); void save(); } }}
        className="field-sizing-content min-h-[38px] w-full resize-none rounded-lg border border-border bg-sidebar/50 px-2.5 py-2 text-[13px] leading-5 text-foreground outline-none focus-visible:border-primary"
      />
      <Segmented<ReviewRuleScope> value={scope} onValueChange={setScope} aria-label="Applies to" disabled={Boolean(busy)}>
        <SegmentedItem value="repository">{workspace.mark}{workspace.name} only</SegmentedItem>
        <SegmentedItem value="all">All workspaces</SegmentedItem>
      </Segmented>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[11px] leading-4 text-muted-foreground">Only you see this rule.</span>
        <Button type="button" variant="outline" disabled={Boolean(busy)} className={OUTLINE} onClick={() => void discard()}>
          {busy === "discard" && <Spinner data-icon="inline-start" />}
          Discard
        </Button>
        <Button type="button" disabled={Boolean(busy) || !text.trim()} className={PRIMARY} onClick={() => void save()}>
          {busy === "save" && <Spinner data-icon="inline-start" />}
          Save rule
        </Button>
      </div>
    </section>
  );
}

/// New commits since the review: which, and Review new changes, which sends
/// the agent only those.
function NewCommits({ commits, busy, onReview }: { commits: { sha: string; title: string }[]; busy: boolean; onReview: () => void }) {
  const count = commits.length;
  return (
    <section aria-label="New commits" data-slot="review-new-commits" className="flex shrink-0 flex-col gap-3 rounded-xl border border-input bg-card p-3.5">
      <div className="flex flex-col gap-1">
        <h3 className="text-[13px] leading-[19px] font-semibold text-foreground">
          {count ? `${count} ${count === 1 ? "commit" : "commits"} since the last review` : "New commits since the last review"}
        </h3>
        <p className="text-xs leading-[18px] text-muted-foreground">The agent reviews only what changed and checks whether its earlier findings were fixed.</p>
      </div>
      {count > 0 && (
        <ul className="flex flex-col gap-1">
          {commits.slice(-8).map((commit) => (
            <li key={commit.sha} className="flex min-w-0 items-center gap-2">
              <span className="w-14 shrink-0 font-mono text-[11px] leading-4 text-muted-foreground">{commit.sha.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-xs leading-4 text-foreground/70">{commit.title}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end">
        <Button type="button" disabled={busy} className={PRIMARY} onClick={onReview}>
          {busy && <Spinner data-icon="inline-start" />}
          Review new changes
        </Button>
      </div>
    </section>
  );
}

type Entry = Record<string, unknown> & { id?: unknown; kind?: unknown; text?: unknown };

/// What the pane draws of the review thread. Remy's own messages to it (the
/// start, Review new changes) become a line or nothing; tool calls and
/// thinking stay in the full thread; the findings list sits where the agent
/// last reported them, and a proposed rule where it proposed it.
function Transcript({
  entries,
  review,
  organizationId,
  target,
  workspace,
  onFinding,
  onProposalDecided,
}: {
  entries: Entry[];
  review: ReviewState;
  organizationId: string;
  target: ReviewTarget;
  workspace: { name: string; mark?: ReactNode };
  onFinding: (finding: ReviewFinding) => void;
  onProposalDecided: (proposal: ReviewRuleProposal, rule?: ReviewRule) => void;
}) {
  const artifacts = (entry: Entry) => (Array.isArray(entry.artifacts) ? entry.artifacts as { kind?: string; id?: string }[] : []);
  const lastReport = entries.reduce((at, entry, index) => (artifacts(entry).some((artifact) => artifact.kind === "review-findings") ? index : at), -1);
  const pending = new Map(review.proposals.map((proposal) => [proposal.id, proposal]));
  const summary = (
    <div key="summary" data-slot="review-summary" className="flex shrink-0 flex-col gap-2.5">
      {review.summary && <Markdown text={review.summary} repository={target.repository} className="text-[13px] leading-5 text-foreground/90" />}
      <FindingsList findings={review.findings} onFinding={onFinding} />
    </div>
  );
  const shown: ReactNode[] = [];
  entries.forEach((entry, index) => {
    const key = String(entry.id ?? index);
    const text = typeof entry.text === "string" ? entry.text : "";
    if (entry.kind === "user") {
      const control = reviewControlMessage(text);
      if (control?.kind === "start") return;
      if (control?.kind === "new-changes") {
        shown.push(<p key={key} className="shrink-0 text-[11px] leading-4 text-muted-foreground">New changes · <span className="font-mono">{control.to.slice(0, 7)}</span></p>);
        return;
      }
      const references = Array.isArray(entry.codeReferences) ? entry.codeReferences as ChatCodeReference[] : [];
      const flag = parseFlagMessage(text);
      shown.push(
        <div key={key} data-slot="review-message" className="flex shrink-0 flex-col items-end gap-1.5">
          {references.map((reference) => (
            <span key={reference.id} className="flex h-[22px] max-w-full shrink-0 items-center gap-1.5 rounded-md border border-input px-2">
              {flag ? <Flag aria-hidden className="size-[11px] shrink-0 text-muted-foreground" /> : <FileCode2 aria-hidden className="size-[11px] shrink-0 text-muted-foreground" />}
              <span className="min-w-0 truncate font-mono text-[11px] leading-4 text-foreground/70" title={reference.path}>{referenceChip(reference)}</span>
            </span>
          ))}
          {flag && !references.length && (
            <span className="flex h-[22px] shrink-0 items-center gap-1.5 rounded-md border border-input px-2 text-[11px] leading-4 text-foreground/70">
              <Flag aria-hidden className="size-[11px] text-muted-foreground" />
              {(() => { const finding = review.findings.find((item) => item.id === flag.findingId); return finding ? referenceChip(finding) : "A finding"; })()}
            </span>
          )}
          {(flag ? flag.words : text) && (
            <div className="max-w-[300px] rounded-xl bg-foreground/6 px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap break-words text-foreground">
              {flag ? flag.words : text}
            </div>
          )}
        </div>,
      );
      return;
    }
    if (entry.kind === "assistant" && text.trim()) {
      shown.push(<Markdown key={key} text={text} repository={target.repository} className="shrink-0 text-[13px] leading-5 text-foreground/90" />);
    }
    for (const artifact of artifacts(entry)) {
      if (artifact.kind === "review-findings" && index === lastReport) shown.push(summary);
      if (artifact.kind === "review-rule" && artifact.id && pending.has(artifact.id)) {
        shown.push(
          <ProposalCard
            key={`proposal:${artifact.id}`}
            organizationId={organizationId}
            proposal={pending.get(artifact.id)!}
            workspace={workspace}
            onDecided={onProposalDecided}
          />,
        );
      }
    }
  });
  // A review read before its report reached this window still lists what the hub has.
  if (lastReport < 0 && (review.findings.length || review.summary)) shown.push(summary);
  // Proposals whose card the transcript no longer carries still wait for you.
  for (const proposal of review.proposals) {
    if (!entries.some((entry) => artifacts(entry).some((artifact) => artifact.kind === "review-rule" && artifact.id === proposal.id))) {
      shown.push(<ProposalCard key={`proposal:${proposal.id}`} organizationId={organizationId} proposal={proposal} workspace={workspace} onDecided={onProposalDecided} />);
    }
  }
  return <>{shown}</>;
}

/// A finding that leans on a lower pull request in the stack says so, and
/// offers to review that one too with the same Start review.
function StackNote({ number, finding, target, rules, onStarted, onViewRules, onOpenPullRequest }: {
  number: number;
  finding: ReviewFinding;
  target?: ReviewTarget;
  rules?: ReviewRule[];
  onStarted: (target: ReviewTarget, requestId: string) => void;
  onViewRules: () => void;
  onOpenPullRequest?: (number: number) => void;
}) {
  const action = "h-4 w-fit p-0 text-xs leading-4 font-medium text-foreground hover:underline";
  return (
    <div data-slot="review-stack-note" className="flex shrink-0 items-start gap-2 rounded-[10px] border border-border px-3 py-2.5">
      <Layers aria-hidden className="mt-0.5 size-[13px] shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-xs leading-[18px] text-foreground/70">
          {findingLocation(finding)} depends on #{number}. If #{number} changes, this finding may no longer apply.
        </p>
        {target ? (
          <ReviewAgentStartPopover
            target={target}
            rules={rules}
            align="start"
            onViewRules={onViewRules}
            onStarted={(requestId) => onStarted(target, requestId)}
            trigger={<button type="button" className={cn(action, "text-left outline-none focus-visible:underline")}>Review #{number} too</button>}
          />
        ) : onOpenPullRequest ? (
          <button type="button" data-link className={cn(action, "text-left outline-none")} onClick={() => onOpenPullRequest(number)}>Open #{number}</button>
        ) : null}
      </div>
    </div>
  );
}

/// The review agent beside a pull request: its state, what it found, what
/// you told it, the rules it proposes, and a composer that talks to its
/// thread. On a phone it is a screen of its own with a way back.
export function ReviewAgentPane({
  organizationId,
  target,
  workspace,
  review,
  start,
  thread,
  rules,
  view,
  onView,
  onClose,
  phone,
  headSha,
  commits,
  stackTarget,
  onOpenPullRequest,
  onOpenThread,
  onFinding,
  onReviewChanged,
  onStarted,
  onRulesChanged,
}: {
  organizationId: string;
  target: ReviewTarget;
  workspace: { name: string; mark?: ReactNode; smallMark?: ReactNode };
  review: ReviewState | null | undefined;
  start?: ThreadStart;
  thread?: HubThread;
  rules?: ReviewRule[];
  view: ReviewPaneView;
  onView: (view: ReviewPaneView) => void;
  onClose: () => void;
  phone: boolean;
  headSha?: string | null;
  commits?: { sha: string; title: string }[];
  stackTarget: (number: number) => ReviewTarget | undefined;
  onOpenPullRequest?: (number: number) => void;
  onOpenThread: (thread: HubThread) => void;
  onFinding: (finding: ReviewFinding) => void;
  onReviewChanged: (review: ReviewState) => void;
  onStarted: (target: ReviewTarget, requestId: string) => void;
  onRulesChanged: () => void;
}) {
  const [computers, setComputers] = useState<ComputerSummary[]>([]);
  useEffect(() => watchHubComputers(organizationId, (items) => setComputers(items), () => undefined), [organizationId]);
  const access = useHubResource<ModelAccessResponse>(organizationId, "/model-access");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<InlineImageComposerValue>({ text: "", attachments: [], uploading: false });
  const editor = useRef<InlineImageComposerHandle>(null);
  const transcript = useRef<HTMLDivElement>(null);
  // A review reads from the top; the pane follows new turns once you are at the bottom or write to it.
  const followsLatest = useRef(false);

  const computerId = review?.computerId ?? start?.created?.computerId ?? start?.computerId;
  const computer = computers.find((entry) => entry.computerId === computerId);
  const computerName = computer?.name ?? cloudComputerName(computerId) ?? start?.computerName ?? "Computer unavailable";
  const picker = threadModelPicker(
    { provider: thread?.detail.provider ?? review?.provider ?? start?.provider, model: thread?.detail.model ?? review?.model ?? start?.model, effort: thread?.detail.effort },
    computer,
    access.value?.providers ?? [],
  );
  const path = review ? hubThreadPath(organizationId, review.computerId, review.threadId) : "";
  const state = start && !review ? (start.phase === "failed" ? "idle" : "working") : thread?.detail.state;
  const working = state === "working";
  const waiting = Boolean(thread?.detail.approval || thread?.detail.question);
  const disabled = !review || !thread || thread.stale || busy;
  const entries = (thread?.detail.entries ?? []) as Entry[];
  const moved = review && headSha ? hasNewCommits(review, headSha) : false;
  const newCommits = review && moved ? commitsSince(commits ?? [], review.reviewedSha ?? review.headSha) : [];
  const dependencies = review ? stackDependencies(review.findings) : [];
  const rulesCount = rules?.length ?? review?.rulesApplied ?? 0;

  useEffect(() => {
    if (followsLatest.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [thread?.revision, review?.updatedAt]);

  const act = async (action: string, input: unknown = {}) => {
    if (!path) return false;
    setBusy(true);
    try {
      await hubRequest(`${path}/${action}`, "POST", input);
      return true;
    } catch (caught) {
      toast.error(action === "interrupt" ? "Couldn't stop the review" : "Couldn't send your message", { description: apiError(caught) });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (disabled || draft.uploading || !draft.text.trim()) return;
    followsLatest.current = true;
    if (await act("message", { text: draft.text, messageId: `u-${crypto.randomUUID()}`, attachmentIds: draft.attachments.map((image) => image.id) })) editor.current?.clear();
  };
  const reviewNew = async () => {
    if (!review || reviewing) return;
    setReviewing(true);
    try {
      const result = await reviewNewChanges(organizationId, review.computerId, review.threadId);
      onReviewChanged(result.review);
    } catch (caught) {
      if (caught instanceof HubRequestError && caught.status === 409) toast("There are no new commits since the review.");
      else toast.error("Couldn't review the new changes", { description: apiError(caught) });
    } finally {
      setReviewing(false);
    }
  };
  const decided = (proposal: ReviewRuleProposal, rule?: ReviewRule) => {
    if (review) onReviewChanged({ ...review, proposals: review.proposals.filter((entry) => entry.id !== proposal.id) });
    if (rule) onRulesChanged();
  };

  const composerModel = picker;

  if (view === "rules") {
    return (
      <PaneFrame phone={phone}>
        <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Spinner className="text-muted-foreground" /></div>}>
          <ReviewAgentRules
            repository={target.repository}
            workspace={workspace}
            rules={rules}
            onBack={() => (review || start ? onView("review") : onClose())}
            onChanged={onRulesChanged}
          />
        </Suspense>
      </PaneFrame>
    );
  }

  return (
    <PaneFrame phone={phone}>
      <div data-slot="review-agent-header" className="flex h-14 shrink-0 items-center gap-2 border-b border-border pr-3 pl-4 max-md:pl-2.5">
        {phone && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Back to the pull request" className="size-7 rounded-lg text-foreground/70" onClick={onClose}>
            <ChevronLeft className="size-[15px]" />
          </Button>
        )}
        <Bot aria-hidden className="size-[15px] shrink-0 text-foreground" />
        <h2 className="text-sm leading-5 font-semibold tracking-[-0.01em] text-foreground">Review agent</h2>
        <StatusChip state={state} />
        <span className="min-w-0 flex-1" />
        <Button type="button" variant="outline" onClick={() => onView("rules")} className="h-7 gap-1.5 rounded-lg border-input bg-transparent px-2.5 text-xs font-normal shadow-none dark:bg-transparent">
          <Book aria-hidden className="size-[13px] text-foreground/70" />
          Rules
          <span className="font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">{rulesCount}</span>
        </Button>
        <Menu>
          <MenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Review agent actions" className="size-7 rounded-lg text-muted-foreground" />}>
            <MoreHorizontal className="size-[15px]" />
          </MenuTrigger>
          <MenuContent align="end" className="w-44">
            <MenuItem data-link disabled={!thread} onClick={() => thread && onOpenThread(thread)}>Open as thread</MenuItem>
            <MenuItem disabled={!working || !path} onClick={() => void act("interrupt")}>Stop</MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <ScrollArea
        className="min-h-0 flex-1"
        viewportProps={{
          ref: transcript,
          "aria-label": "Review agent transcript",
          onScroll: (event) => {
            const node = event.currentTarget;
            followsLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
          },
        }}
      >
        <div className="flex flex-col gap-[18px] px-4 pt-4 pb-3">
          {moved && review ? (
            <>
              <NewCommits commits={newCommits} busy={reviewing} onReview={() => void reviewNew()} />
              <p className="text-[11px] leading-4 text-muted-foreground">Earlier · <span className="font-mono">{(review.reviewedSha ?? review.headSha).slice(0, 7)}</span></p>
            </>
          ) : review ? (
            <div data-slot="review-run" className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4">
              <Monitor aria-hidden className="size-3 shrink-0 text-muted-foreground" />
              <span className="text-foreground/70">{computerName}</span>
              <span aria-hidden className="text-muted-foreground/60">·</span>
              <span className="text-foreground/70">{modelLabel(composerModel.providers, composerModel.value)}</span>
              <span aria-hidden className="text-muted-foreground/60">·</span>
              <span className="font-mono text-muted-foreground">{(review.reviewedSha ?? review.headSha).slice(0, 7)}</span>
              <span aria-hidden className="text-muted-foreground/60">·</span>
              <span className="text-foreground/70">{review.rulesApplied} {review.rulesApplied === 1 ? "rule" : "rules"} applied</span>
            </div>
          ) : null}
          {review && (
            <Transcript
              entries={entries}
              review={review}
              organizationId={organizationId}
              target={target}
              workspace={{ name: workspace.name, mark: workspace.smallMark }}
              onFinding={onFinding}
              onProposalDecided={decided}
            />
          )}
          {review && dependencies.map(({ number, finding }) => (
            <StackNote
              key={number}
              number={number}
              finding={finding}
              target={stackTarget(number)}
              rules={rules}
              onStarted={onStarted}
              onViewRules={() => onView("rules")}
              onOpenPullRequest={onOpenPullRequest}
            />
          ))}
          {start && !review && (
            start.phase === "failed" ? (
              <div role="alert" className="flex flex-col gap-2 rounded-[10px] border border-border p-3">
                <p className="text-xs leading-[18px] text-destructive">{start.error || "The review couldn't start."}</p>
                <Button type="button" variant="outline" className={cn(OUTLINE, "w-fit")} onClick={() => void retryHubThread(start)}>
                  <RefreshCw data-icon="inline-start" />
                  Try again
                </Button>
              </div>
            ) : <ThreadStartMarker progress={start.progress} />
          )}
          {review === undefined && !start && <Spinner className="self-center text-muted-foreground" />}
          {review && waiting && thread && (
            <div className="flex flex-col gap-2 rounded-[10px] border border-warning/40 p-3">
              <p className="text-xs leading-[18px] text-foreground/70">The review agent is waiting for you to answer it.</p>
              <Button type="button" variant="outline" data-link className={cn(OUTLINE, "w-fit")} onClick={() => onOpenThread(thread)}>Open as thread</Button>
            </div>
          )}
          {review && working && !waiting && (
            <Marker role="status" aria-label="Reviewing" className="min-w-0 py-0.5">
              <MarkerIcon><Loader2Icon className="animate-spin" /></MarkerIcon>
              <MarkerContent className="shimmer">Reviewing</MarkerContent>
            </Marker>
          )}
          {review && thread && !thread.detail.entries?.length && !review.findings.length && !working && (
            <p className="text-xs leading-[18px] text-muted-foreground">Nothing from the review agent yet.</p>
          )}
        </div>
      </ScrollArea>
      <div className="shrink-0 px-3 pb-3">
        <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="@container min-w-0">
          <ReplyComposer
            working={working && !!review}
            disabled={disabled}
            onStop={() => void act("interrupt")}
            canSend={!disabled && !draft.uploading && !!draft.text.trim()}
            controls={computerId === CURSOR_CLOUD_COMPUTER_ID || !review
              ? <InputGroupText className="text-[11px]">{review ? "Cursor Cloud default" : modelLabel(composerModel.providers, composerModel.value)}</InputGroupText>
              : <ModelPickerButton variant="composer" catalogue={composerModel.providers} onlyProvider={composerModel.modelProvider} value={composerModel.value} disabled={disabled} onPick={(choice) => void act("options", composerModel.options(choice))} />}
          >
            <InlineImageComposer
              key={path || "pending"}
              ref={editor}
              ariaLabel="Message the review agent"
              placeholder="Ask the review agent, or tell it what it got wrong"
              disabled={disabled}
              onChange={setDraft}
              onSubmit={() => void send()}
              onError={(message) => toast.error(message)}
              onUpload={async (file) => {
                const response = await fetch(`${path}/attachments`, { method: "POST", headers: { "content-type": file.type, "x-filename": file.name }, body: file });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error ?? "This image could not be attached.");
                return { id: result.id, name: file.name, mimeType: file.type as "image/png" | "image/jpeg" | "image/gif" | "image/webp", sizeBytes: file.size };
              }}
            />
          </ReplyComposer>
        </form>
      </div>
    </PaneFrame>
  );
}

/// 400px beside the pull request on a desktop; the whole screen, pushed
/// over it, on a phone.
function PaneFrame({ phone, children }: { phone: boolean; children: ReactNode }) {
  return (
    <aside
      aria-label="Review agent"
      data-slot="review-agent-pane"
      className={cn("flex min-h-0 shrink-0 flex-col bg-background", phone ? "w-full flex-1" : "w-[400px] border-l border-border")}
    >
      {children}
    </aside>
  );
}
