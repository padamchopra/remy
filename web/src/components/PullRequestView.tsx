import { useEffect, useId, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { PullRequestStackInfo } from "@/components/PullRequestStackInfo";
import { FilePathLabel, PullRequestContextGap, PullRequestFileButton, usePullRequestFileContent } from "@/components/PullRequestFileContext";
import { fileContextGaps } from "@/lib/pull-request-context";
import type { PullRequestStack } from "@/state/types";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpenCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  ExternalLink,
  Files,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  LoaderCircle,
  MessageSquare,
  MessageSquarePlus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { ModelPickerButton } from "@/components/ModelPicker";
import { PullRequestMonitoringButton } from "@/components/PullRequestMonitoring";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Message, MessageContent, MessageGroup, MessageHeader } from "@/components/ui/message";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { apiError } from "@/lib/api-error";
import type { ModelChoice } from "@/lib/providers";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type {
  ChatCodeReference,
  PullRequestDiff as PullRequestData,
  PullRequestDiffFile,
  PullRequestDiffLine,
  PullRequestGuide,
  PullRequestGuideCommit,
  PullRequestGuideHunk,
  PullRequestGuideStep,
  PullRequestTimelineItem,
} from "@/state/types";

interface Selection {
  fileIndex: number;
  hunkIndex: number;
  anchor: number;
  focus: number;
}

interface GuideSelection {
  hunkId: string;
  anchor: number;
  focus: number;
}

type PullRequestTab = "summary" | "code" | "guide";

async function findSavedGuide(repository: string, number: number, fallbackServerId: string) {
  const servers = await transport.servers();
  const localServerId = servers.find((server) => server.local)?.id ?? fallbackServerId;
  const params = new URLSearchParams({ repository, number: String(number) });
  const result = await transport.request<{ guide?: PullRequestGuide; peerId?: string }>(
    localServerId, `/pull-requests/guide/discover?${params}`,
  );
  return { guide: result.guide, serverId: result.peerId ?? localServerId, localServerId };
}

export function PullRequestView({
  serverId,
  repository,
  number,
  chatId,
  codeReferences = [],
  onAddReference,
  onRemoveReference,
  onPullRequestChanged,
  leadingActions,
  actions,
  stack,
}: {
  serverId: string;
  repository?: string;
  number?: number;
  chatId?: string;
  codeReferences?: ChatCodeReference[];
  onAddReference?: (reference: ChatCodeReference) => void;
  onRemoveReference?: (id: string) => void;
  onPullRequestChanged?: () => void;
  leadingActions?: ReactNode;
  actions?: ReactNode;
  stack?: PullRequestStack | null;
}) {
  const [pullRequest, setPullRequest] = useState<PullRequestData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<PullRequestTab>("summary");
  const [timeline, setTimeline] = useState<PullRequestTimelineItem[]>();
  const [timelineError, setTimelineError] = useState("");
  const [selection, setSelection] = useState<Selection>();
  const [comment, setComment] = useState("");
  const [markingReady, setMarkingReady] = useState(false);
  const [markingViewed, setMarkingViewed] = useState<Set<string>>(new Set());
  const [reviewServerId, setReviewServerId] = useState(serverId);
  const [guide, setGuide] = useState<PullRequestGuide>();
  const [guideOwnerServerId, setGuideOwnerServerId] = useState(serverId);
  const [guideLookupServerId, setGuideLookupServerId] = useState(serverId);
  const [guideUnavailable, setGuideUnavailable] = useState(false);
  const [guideCommits, setGuideCommits] = useState<PullRequestGuideCommit[]>([]);
  const [guideChoice, setGuideChoice] = useState<ModelChoice>({ provider: "claude", model: "", effort: "" });
  const [guideCommitShas, setGuideCommitShas] = useState<Set<string>>(new Set());
  const [guideLoaded, setGuideLoaded] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideError, setGuideError] = useState("");
  const [generatingGuide, setGeneratingGuide] = useState(false);
  const [guideSelection, setGuideSelection] = useState<GuideSelection>();
  const [guideQuestion, setGuideQuestion] = useState("");
  const [askingGuide, setAskingGuide] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setPullRequest(undefined);
    setTimeline(undefined);
    setTimelineError("");
    setSelection(undefined);
    setReviewServerId(serverId);
    setGuide(undefined);
    setGuideOwnerServerId(serverId);
    setGuideLookupServerId(serverId);
    setGuideUnavailable(false);
    setGuideCommits([]);
    setGuideCommitShas(new Set());
    setGuideLoaded(false);
    setGuideLoading(false);
    setGuideError("");
    setGuideSelection(undefined);
    setGuideQuestion("");
    const path = chatId
      ? `/chats/${encodeURIComponent(chatId)}/pull-request-diff`
      : `/pull-requests/diff?repository=${encodeURIComponent(repository ?? "")}&number=${number ?? ""}`;
    void transport.request<{ diff: PullRequestData }>(serverId, path)
      .then((response) => {
        if (!current) return;
        setPullRequest(response.diff);
        if (response.diff.nodeId) return;
        void transport.servers()
          .then((servers) => servers.find((candidate) => candidate.local)?.id)
          .then(async (localServerId) => {
            if (!localServerId || localServerId === serverId) return;
            const reviewPath = `/pull-requests/file-views?repository=${encodeURIComponent(response.diff.repository)}&number=${response.diff.number}`;
            const reviewResponse = await transport.request<{
              review: { nodeId: string; files: Array<{ path: string; viewed: boolean }> };
            }>(localServerId, reviewPath);
            if (!current) return;
            const viewed = new Map(reviewResponse.review.files.map((file) => [file.path, file.viewed]));
            setReviewServerId(localServerId);
            setPullRequest((loaded) => loaded ? {
              ...loaded,
              nodeId: reviewResponse.review.nodeId,
              files: loaded.files.map((file) => ({ ...file, viewed: viewed.get(file.path) ?? false })),
            } : loaded);
          })
          .catch(() => undefined);
      })
      .catch((caught) => {
        if (current) setError(apiError(caught));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [chatId, number, repository, serverId]);

  useEffect(() => {
    if (tab !== "summary" || !pullRequest || timeline || timelineError) return;
    let current = true;
    const path = `/pull-requests/timeline?repository=${encodeURIComponent(pullRequest.repository)}&number=${pullRequest.number}`;
    void transport.request<{ timeline?: PullRequestTimelineItem[] }>(serverId, path)
      .then((response) => {
        if (current) setTimeline(response.timeline ?? []);
      })
      .catch((caught) => {
        if (current) setTimelineError(apiError(caught));
      });
    return () => { current = false; };
  }, [pullRequest, serverId, tab, timeline, timelineError]);

  useEffect(() => {
    if (tab !== "guide" || !pullRequest || guideLoaded) return;
    let current = true;
    setGuideLoading(true);
    setGuideError("");
    const params = new URLSearchParams({
      repository: pullRequest.repository,
      number: String(pullRequest.number),
      ...(chatId ? { chatId } : {}),
    });
    const timeout = window.setTimeout(() => {
      if (!current) return;
      setGuideError("This device didn't answer. Try again when it is available.");
      setGuideUnavailable(Boolean(guide));
      setGuideLoaded(true);
      setGuideLoading(false);
      current = false;
    }, 20_000);
    const load = async () => {
      if (guide) {
        const saved = await transport.request<{ guide?: PullRequestGuide }>(guideOwnerServerId, `/pull-requests/guide/saved?${params}`);
        if (!saved.guide) throw new Error("The saved guide is unavailable. Try connecting again.");
        return {
          guide: saved.guide, commits: saved.guide.commits,
          defaultChoice: { provider: saved.guide.provider, model: saved.guide.model, effort: saved.guide.effort },
          owner: guideOwnerServerId, local: guideLookupServerId,
        };
      }
      const saved = await findSavedGuide(pullRequest.repository, pullRequest.number, serverId);
      if (saved.guide) return {
        guide: saved.guide, commits: saved.guide.commits,
        defaultChoice: { provider: saved.guide.provider, model: saved.guide.model, effort: saved.guide.effort },
        owner: saved.serverId, local: saved.localServerId,
      };
      const context = await transport.request<{
        guide?: PullRequestGuide;
        commits: PullRequestGuideCommit[];
        defaultChoice: ModelChoice;
      }>(serverId, `/pull-requests/guide?${params}`);
      return { ...context, owner: serverId, local: saved.localServerId };
    };
    void load()
      .then((response) => {
        if (!current) return;
        window.clearTimeout(timeout);
        setGuide(response.guide);
        setGuideOwnerServerId(response.owner);
        setGuideLookupServerId(response.local);
        setGuideUnavailable(false);
        setGuideCommits(response.commits);
        setGuideChoice(response.guide
          ? { provider: response.guide.provider, model: response.guide.model, effort: response.guide.effort }
          : response.defaultChoice);
        setGuideCommitShas(new Set(response.guide?.commitShas ?? response.commits.map((commit) => commit.sha)));
        setGuideLoaded(true);
      })
      .catch((caught) => {
        if (!current) return;
        window.clearTimeout(timeout);
        setGuideError(apiError(caught));
        setGuideUnavailable(Boolean(guide));
        setGuideLoaded(true);
      })
      .finally(() => { if (current) setGuideLoading(false); });
    return () => { current = false; window.clearTimeout(timeout); };
  }, [chatId, guideLoaded, guide, guideOwnerServerId, guideLookupServerId, pullRequest, serverId, tab]);

  useEffect(() => {
    const offPush = transport.subscribe((source, payload) => {
      if (tab !== "guide" || !pullRequest || !payload || typeof payload !== "object") return;
      const frame = payload as { type?: unknown; repository?: unknown; number?: unknown };
      if (frame.type === "peer-disconnected" && source === guideOwnerServerId && guide) {
        setGuideUnavailable(true);
        return;
      }
      const reconnect = (frame.type === "hello" || frame.type === "peer-reset")
        && (!guide || source === guideOwnerServerId || source === guideLookupServerId);
      const changed = frame.type === "pull-request-guide" && (!guide || source === guideOwnerServerId)
        && frame.repository === pullRequest.repository && frame.number === pullRequest.number;
      if (reconnect || changed || (frame.type === "peers" && !guide)) setGuideLoaded(false);
    });
    const offStatus = transport.onStatus((source, online) => {
      if (tab !== "guide" || (source !== guideLookupServerId && source !== guideOwnerServerId)) return;
      if (online) setGuideLoaded(false);
      else if (guide) setGuideUnavailable(true);
    });
    return () => { offPush(); offStatus(); };
  }, [guide, guideLookupServerId, guideOwnerServerId, pullRequest, tab]);

  const selected = useMemo(() => {
    if (!selection || !pullRequest) return undefined;
    const file = pullRequest.files[selection.fileIndex];
    const hunk = file?.hunks[selection.hunkIndex];
    if (!file || !hunk) return undefined;
    const start = Math.min(selection.anchor, selection.focus);
    const end = Math.max(selection.anchor, selection.focus);
    const lines = hunk.lines.slice(start, end + 1);
    const numbers = lines.map((line) => line.newLine ?? line.oldLine).filter((line): line is number => line !== null);
    if (numbers.length === 0) return undefined;
    return { file, lines, startLine: Math.min(...numbers), endLine: Math.max(...numbers) };
  }, [pullRequest, selection]);

  const selectLine = (event: MouseEvent, fileIndex: number, hunkIndex: number, lineIndex: number) => {
    setSelection((current) => event.shiftKey && current?.fileIndex === fileIndex && current.hunkIndex === hunkIndex
      ? { ...current, focus: lineIndex }
      : { fileIndex, hunkIndex, anchor: lineIndex, focus: lineIndex });
  };

  const addComment = () => {
    const body = comment.trim();
    if (!selected || !body || !onAddReference) return;
    onAddReference({
      id: crypto.randomUUID(),
      path: selected.file.path,
      startLine: selected.startLine,
      endLine: selected.endLine,
      comment: body,
      lines: selected.lines,
    });
    setComment("");
    setSelection(undefined);
  };

  const markReady = async () => {
    if (!pullRequest || markingReady) return;
    setMarkingReady(true);
    try {
      await transport.request(serverId, "/pull-requests/ready", {
        method: "POST",
        body: { repository: pullRequest.repository, number: pullRequest.number },
      });
      setPullRequest((current) => current ? { ...current, isDraft: false } : current);
      onPullRequestChanged?.();
      toast.success("Pull request is ready for review.");
    } catch (caught) {
      toast.error("Couldn't mark the pull request ready", { description: apiError(caught) });
    } finally {
      setMarkingReady(false);
    }
  };

  const markFileViewed = async (path: string, viewed: boolean) => {
    if (!pullRequest?.nodeId || markingViewed.has(path)) return;
    const previous = pullRequest.files.find((file) => file.path === path)?.viewed ?? false;
    setMarkingViewed((current) => new Set(current).add(path));
    setPullRequest((current) => current ? {
      ...current,
      files: current.files.map((file) => file.path === path ? { ...file, viewed } : file),
    } : current);
    try {
      await transport.request(reviewServerId, "/pull-requests/file-viewed", {
        method: "POST",
        body: { pullRequestId: pullRequest.nodeId, path, viewed },
      });
    } catch (caught) {
      setPullRequest((current) => current ? {
        ...current,
        files: current.files.map((file) => file.path === path ? { ...file, viewed: previous } : file),
      } : current);
      toast.error("Couldn't update the file", { description: apiError(caught) });
    } finally {
      setMarkingViewed((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  };

  const startGuide = async () => {
    if (!pullRequest || generatingGuide || guideCommitShas.size === 0) return;
    setGeneratingGuide(true);
    setGuideError("");
    try {
      const saved = await findSavedGuide(pullRequest.repository, pullRequest.number, serverId);
      if (saved.guide) {
        setGuide(saved.guide);
        setGuideOwnerServerId(saved.serverId);
        setGuideLookupServerId(saved.localServerId);
        setGuideLoaded(true);
        setGuideUnavailable(false);
        return;
      }
      const response = await transport.request<{ guide: PullRequestGuide }>(serverId, "/pull-requests/guide", {
        method: "POST",
        body: {
          repository: pullRequest.repository,
          number: pullRequest.number,
          ...(chatId ? { chatId } : {}),
          provider: guideChoice.provider,
          model: guideChoice.model,
          effort: guideChoice.effort ?? "",
          commitShas: guideCommits.filter((commit) => guideCommitShas.has(commit.sha)).map((commit) => commit.sha),
        },
      });
      setGuide(response.guide);
      setGuideOwnerServerId(serverId);
      setGuideUnavailable(false);
      setGuideLoaded(true);
      setGuideSelection(undefined);
      toast.success("Guided review is ready.");
    } catch (caught) {
      setGuideError(apiError(caught));
      toast.error("Couldn't start the guided review", { description: apiError(caught) });
    } finally {
      setGeneratingGuide(false);
    }
  };

  const askGuideQuestion = async () => {
    const question = guideQuestion.trim();
    if (!pullRequest || !guide || !guideSelection || !question || askingGuide || guideUnavailable) return;
    setAskingGuide(true);
    try {
      const response = await transport.request<{ guide: PullRequestGuide }>(guideOwnerServerId, "/pull-requests/guide/question", {
        method: "POST",
        body: {
          repository: pullRequest.repository,
          number: pullRequest.number,
          stepId: guide.steps.find((step) => step.hunkIds.includes(guideSelection.hunkId))?.id ?? "uncovered",
          hunkId: guideSelection.hunkId,
          start: Math.min(guideSelection.anchor, guideSelection.focus),
          end: Math.max(guideSelection.anchor, guideSelection.focus),
          question,
        },
      });
      setGuide(response.guide);
      setGuideQuestion("");
      setGuideSelection(undefined);
    } catch (caught) {
      toast.error("Couldn't answer that question", { description: apiError(caught) });
    } finally {
      setAskingGuide(false);
    }
  };

  if (loading) return <PullRequestLoading leadingActions={leadingActions} />;
  if (error || !pullRequest) {
    const title = chatId ? "No pull request yet" : "Couldn't load this pull request";
    const description = chatId
      ? "Open one for this branch, then refresh."
      : "Refresh the list and try again.";
    return (
      <div className="flex h-full min-h-0 flex-col">
        {leadingActions && (
          <div className="flex h-10 shrink-0 items-center border-b border-border px-3">{leadingActions}</div>
        )}
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const changedFiles = pullRequest.changedFiles || pullRequest.files.length;

  return (
    <Tabs value={tab} onValueChange={(value) => {
      setTab(value as PullRequestTab);
      if (value === "guide") setGuideLoaded(false);
    }} className="size-full min-h-0 gap-0">
      <header className="shrink-0 border-b border-border">
        <div className="flex h-10 min-w-0 items-center gap-3 px-3">
          {leadingActions}
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
            <GitPullRequest className="size-4 shrink-0" />
            <span className="min-w-0 truncate">
              <span className="font-medium text-foreground">{pullRequest.repository}</span>
              <span> #{pullRequest.number}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center justify-end gap-1">
            {actions}
            {chatId && pullRequest.workspaceId && (
              <PullRequestMonitoringButton
                serverId={serverId}
                workspaceId={pullRequest.workspaceId}
                repository={pullRequest.repository}
                number={pullRequest.number}
                chatId={chatId}
              />
            )}
            {pullRequest.isDraft && (
              <Button size="sm" disabled={markingReady} onClick={() => void markReady()}>
                Mark ready
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon-sm">
                  <a href={pullRequest.url} target="_blank" rel="noreferrer" data-link aria-label="Open pull request on GitHub">
                    <ExternalLink />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open on GitHub</TooltipContent>
            </Tooltip>
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 px-3">
          <TabsList
            variant="line"
            aria-label="Pull request views"
            className="h-9 justify-start gap-0 rounded-none px-0 py-0"
          >
            <TabsTrigger value="summary" className="h-full flex-none rounded-none px-2 text-xs after:bottom-0">
              Summary
            </TabsTrigger>
            <TabsTrigger value="code" className="h-full flex-none rounded-none px-2 text-xs after:bottom-0">
              Code <span className="text-[11px] tabular-nums text-muted-foreground">{changedFiles}</span>
            </TabsTrigger>
            <TabsTrigger value="guide" className="h-full flex-none rounded-none px-2 text-xs after:bottom-0">
              Guide
            </TabsTrigger>
          </TabsList>
          <PullRequestStackInfo
            key={`${serverId}:${pullRequest.repository}:${pullRequest.number}`}
            serverId={serverId}
            repository={pullRequest.repository}
            number={pullRequest.number}
            initialStack={stack}
          />
        </div>
      </header>

      <TabsContent value="summary" className="min-h-0 overflow-hidden">
        <PullRequestSummary pullRequest={pullRequest} timeline={timeline} timelineError={timelineError} />
      </TabsContent>
      <TabsContent value="code" className="min-h-0 overflow-hidden">
        <PullRequestFiles
          serverId={serverId}
          pullRequest={pullRequest}
          selection={selection}
          selected={selected}
          comment={comment}
          codeReferences={codeReferences}
          interactive={Boolean(onAddReference)}
          onCommentChange={setComment}
          onSelectLine={selectLine}
          onAddComment={addComment}
          onRemoveReference={onRemoveReference}
          markingViewed={markingViewed}
          onViewedChange={markFileViewed}
        />
      </TabsContent>
      <TabsContent value="guide" className="min-h-0 overflow-hidden">
        <PullRequestGuideView
          guide={guide}
          commits={guideCommits}
          choice={guideChoice}
          selectedCommitShas={guideCommitShas}
          loading={guideLoading}
          generating={generatingGuide}
          error={guideError}
          selection={guideSelection}
          question={guideQuestion}
          asking={askingGuide}
          unavailable={guideUnavailable}
          onChoiceChange={setGuideChoice}
          onCommitSelectionChange={setGuideCommitShas}
          onRetry={() => { setGuideLoaded(false); setGuideError(""); }}
          onStart={() => void startGuide()}
          onSelectLine={(event, hunkId, lineIndex) => {
            setGuideSelection((current) => event.shiftKey && current?.hunkId === hunkId
              ? { ...current, focus: lineIndex }
              : { hunkId, anchor: lineIndex, focus: lineIndex });
          }}
          onQuestionChange={setGuideQuestion}
          onAsk={() => void askGuideQuestion()}
        />
      </TabsContent>
    </Tabs>
  );
}

function PullRequestGuideView({
  guide,
  commits,
  choice,
  selectedCommitShas,
  loading,
  generating,
  error,
  selection,
  question,
  asking,
  unavailable,
  onChoiceChange,
  onCommitSelectionChange,
  onRetry,
  onStart,
  onSelectLine,
  onQuestionChange,
  onAsk,
}: {
  guide?: PullRequestGuide;
  commits: PullRequestGuideCommit[];
  choice: ModelChoice;
  selectedCommitShas: ReadonlySet<string>;
  loading: boolean;
  generating: boolean;
  error: string;
  selection?: GuideSelection;
  question: string;
  asking: boolean;
  unavailable: boolean;
  onChoiceChange: (choice: ModelChoice) => void;
  onCommitSelectionChange: (commits: Set<string>) => void;
  onRetry: () => void;
  onStart: () => void;
  onSelectLine: (event: MouseEvent, hunkId: string, lineIndex: number) => void;
  onQuestionChange: (value: string) => void;
  onAsk: () => void;
}) {
  if (loading && !guide) {
    return (
      <div className="mx-auto flex h-full max-w-4xl flex-col gap-5 px-8 py-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!guide) {
    return (
      <ScrollArea className="h-full">
        <Empty className="min-h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon"><BookOpenCheck /></EmptyMedia>
            <EmptyTitle>Build a guided review</EmptyTitle>
            <EmptyDescription>Choose the changes and a model, then start with a clearer reading order.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-md items-stretch text-left">
            <FieldGroup className="gap-4">
              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel htmlFor="guide-model">Model</FieldLabel>
                  <FieldDescription>Uses the thread or workspace model at low effort by default.</FieldDescription>
                </FieldContent>
                <ModelPickerButton
                  id="guide-model"
                  value={choice}
                  onPick={onChoiceChange}
                  className="w-full @md/field-group:w-72"
                />
              </Field>
              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel>Commits</FieldLabel>
                  <FieldDescription>All commits are included until you narrow the guide.</FieldDescription>
                </FieldContent>
                <GuideCommitPicker
                  commits={commits}
                  selected={selectedCommitShas}
                  onChange={onCommitSelectionChange}
                />
              </Field>
            </FieldGroup>
            {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
            <div className="flex justify-center gap-2">
              {error && commits.length === 0 && (
                <Button type="button" variant="outline" onClick={onRetry}>Try again</Button>
              )}
              <Button type="button" disabled={generating || selectedCommitShas.size === 0 || commits.length === 0} onClick={onStart}>
                {generating ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Sparkles data-icon="inline-start" />}
                {generating ? "Building guide…" : "Start review"}
              </Button>
            </div>
          </EmptyContent>
        </Empty>
      </ScrollArea>
    );
  }

  const chosenHunk = selection ? guide.hunks.find((hunk) => hunk.id === selection.hunkId) : undefined;
  const surfacedHunkIds = new Set(guide.steps.flatMap((step) => step.hunkIds));
  const uncoveredHunkIds = guide.hunks.map((hunk) => hunk.id).filter((id) => !surfacedHunkIds.has(id));
  const uncoveredHunks = uncoveredHunkIds.flatMap((id) => {
    const hunk = guide.hunks.find((entry) => entry.id === id);
    return hunk ? [hunk] : [];
  });
  const chosenLines = chosenHunk && selection
    ? chosenHunk.lines.slice(Math.min(selection.anchor, selection.focus), Math.max(selection.anchor, selection.focus) + 1)
    : [];
  const chosenNumbers = chosenLines
    .map((line) => line.newLine ?? line.oldLine)
    .filter((line): line is number => line !== null);
  const chosenLabel = chosenHunk && chosenNumbers.length > 0
    ? referenceLabel({ path: chosenHunk.path, startLine: Math.min(...chosenNumbers), endLine: Math.max(...chosenNumbers) })
    : "Selected lines";

  return (
    <div className="flex size-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-7 sm:px-8 lg:px-10">
          <div className="flex min-w-0 items-start gap-3">
            <BookOpenCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold">Guided review</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {guide.commits.length} {guide.commits.length === 1 ? "commit" : "commits"} · {guide.steps.length} {guide.steps.length === 1 ? "step" : "steps"}
              </p>
            </div>
          </div>
          {unavailable && (
            <div className="flex min-w-0 flex-wrap items-center gap-3" role="status">
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">The device holding this guide is unavailable, but you can keep reading.</p>
              <Button variant="outline" size="sm" disabled={loading} onClick={onRetry}>Retry connection</Button>
            </div>
          )}
          {guide.steps.map((step, index) => (
            <GuideStep
              key={step.id}
              step={step}
              index={index}
              guide={guide}
              selection={selection}
              onSelectLine={onSelectLine}
            />
          ))}
          {uncoveredHunks.length > 0 && (
            <GuideCoverage
              hunks={uncoveredHunks}
              guide={guide}
              selection={selection}
              onSelectLine={onSelectLine}
            />
          )}
        </div>
      </ScrollArea>
      {selection && chosenHunk && (
        <div className="shrink-0 border-t border-border bg-background p-3">
          <InputGroup>
            <InputGroupTextarea
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onAsk();
                }
              }}
              placeholder="Ask about these lines."
              aria-label="Guided review question"
              className="min-h-16"
            />
            <InputGroupAddon align="block-end" className="border-t">
              <InputGroupText>{chosenLabel}</InputGroupText>
              <InputGroupButton className="ml-auto" variant="default" disabled={!question.trim() || asking || unavailable} onClick={onAsk}>
                {asking ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}
                {asking ? "Answering…" : "Ask"}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      )}
    </div>
  );
}

function GuideCoverage({
  hunks,
  guide,
  selection,
  onSelectLine,
}: {
  hunks: PullRequestGuideHunk[];
  guide: PullRequestGuide;
  selection?: GuideSelection;
  onSelectLine: (event: MouseEvent, hunkId: string, lineIndex: number) => void;
}) {
  const step: PullRequestGuideStep = {
    id: "uncovered",
    title: "Changes the guide missed",
    summary: "These changes are in the selected diff but not in a generated step.",
    hunkIds: hunks.map((hunk) => hunk.id),
  };
  return (
    <section className="min-w-0 border-t border-border pt-8">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
        <Badge variant="outline" className="mt-0.5 size-7 justify-center rounded-full p-0"><Files /></Badge>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{step.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{step.summary}</p>
        </div>
      </div>
      <div className="mt-5 flex min-w-0 flex-col gap-4">
        {hunks.map((hunk) => (
          <GuideHunk
            key={hunk.id}
            hunk={hunk}
            step={step}
            guide={guide}
            selection={selection}
            onSelectLine={onSelectLine}
          />
        ))}
      </div>
    </section>
  );
}

function GuideCommitPicker({
  commits,
  selected,
  onChange,
}: {
  commits: PullRequestGuideCommit[];
  selected: ReadonlySet<string>;
  onChange: (commits: Set<string>) => void;
}) {
  const all = commits.length > 0 && selected.size === commits.length;
  const label = all
    ? `All ${commits.length} ${commits.length === 1 ? "commit" : "commits"}`
    : `${selected.size} of ${commits.length} commits`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full justify-start font-normal @md/field-group:w-72">
          <GitCommitHorizontal data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown data-icon="inline-end" className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Include commits</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            checked={all ? true : selected.size > 0 ? "indeterminate" : false}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => onChange(checked ? new Set(commits.map((commit) => commit.sha)) : new Set())}
          >
            All commits
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {commits.map((commit) => (
            <DropdownMenuCheckboxItem
              key={commit.sha}
              checked={selected.has(commit.sha)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(commit.sha);
                else next.delete(commit.sha);
                onChange(next);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{commit.title}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{commit.sha.slice(0, 7)}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function GuideStep({
  step,
  index,
  guide,
  selection,
  onSelectLine,
}: {
  step: PullRequestGuideStep;
  index: number;
  guide: PullRequestGuide;
  selection?: GuideSelection;
  onSelectLine: (event: MouseEvent, hunkId: string, lineIndex: number) => void;
}) {
  const hunks = step.hunkIds.flatMap((id) => {
    const hunk = guide.hunks.find((entry) => entry.id === id);
    return hunk ? [hunk] : [];
  });
  return (
    <section className="min-w-0">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
        <Badge variant="secondary" className="mt-0.5 size-7 justify-center rounded-full p-0 tabular-nums">{index + 1}</Badge>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{step.title}</h2>
          <Markdown text={step.summary} className="mt-2 text-sm text-muted-foreground" />
        </div>
      </div>
      <div className="mt-5 flex min-w-0 flex-col gap-4">
        {hunks.map((hunk) => (
          <GuideHunk
            key={hunk.id}
            hunk={hunk}
            step={step}
            guide={guide}
            selection={selection}
            onSelectLine={onSelectLine}
          />
        ))}
      </div>
    </section>
  );
}

function GuideHunk({
  hunk,
  step,
  guide,
  selection,
  onSelectLine,
}: {
  hunk: PullRequestGuideHunk;
  step: PullRequestGuideStep;
  guide: PullRequestGuide;
  selection?: GuideSelection;
  onSelectLine: (event: MouseEvent, hunkId: string, lineIndex: number) => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border">
      <div className="flex min-w-0 flex-col gap-1 bg-muted/50 px-3 py-2 font-mono text-[10px] text-muted-foreground">
        <FilePathLabel path={hunk.path} />
        <span className="break-all">{hunk.header}</span>
      </div>
      <div className="font-mono text-[11px] leading-5">
        {hunk.lines.map((line, lineIndex) => {
          const chosen = selection?.hunkId === hunk.id
            && lineIndex >= Math.min(selection.anchor, selection.focus)
            && lineIndex <= Math.max(selection.anchor, selection.focus);
          const questions = guide.questions.filter((entry) =>
            entry.stepId === step.id && entry.hunkId === hunk.id && entry.end === lineIndex);
          return (
            <div key={`${line.oldLine}:${line.newLine}:${lineIndex}`}>
              <PullRequestLine
                line={line}
                lineIndex={lineIndex}
                chosen={chosen}
                interactive
                onClick={(event) => onSelectLine(event, hunk.id, lineIndex)}
              />
              {questions.length > 0 && (
                <MessageGroup className="gap-3 border-y border-border bg-muted/30 px-4 py-4 font-sans">
                  {questions.map((entry) => (
                    <div key={entry.id} className="flex flex-col gap-2">
                      <Message align="end">
                        <MessageContent><Bubble variant="secondary" align="end"><BubbleContent>{entry.question}</BubbleContent></Bubble></MessageContent>
                      </Message>
                      <Message>
                        <MessageContent>
                          <Bubble variant="outline"><BubbleContent><Markdown text={entry.answer} className="text-sm" /></BubbleContent></Bubble>
                        </MessageContent>
                      </Message>
                    </div>
                  ))}
                </MessageGroup>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PullRequestLoading({ leadingActions }: { leadingActions?: ReactNode }) {
  return (
    <div className="size-full">
      <div className="border-b border-border">
        <div className="flex h-10 items-center gap-3 px-3">
          {leadingActions}
          <Skeleton className="h-3 w-40" />
          <Skeleton className="ml-auto h-8 w-36" />
        </div>
        <div className="flex h-9 items-center gap-3 px-3">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-14" />
        </div>
      </div>
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-8 py-8">
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-3 h-32 w-full" />
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}

function PullRequestStateBadge({ pullRequest }: { pullRequest: PullRequestData }) {
  if (pullRequest.state === "MERGED") return <Badge variant="info">Merged</Badge>;
  if (pullRequest.state === "CLOSED") return <Badge variant="secondary">Closed</Badge>;
  return <Badge variant={pullRequest.isDraft ? "secondary" : "success"}>{pullRequest.isDraft ? "Draft" : "Open"}</Badge>;
}

function PullRequestSummary({
  pullRequest,
  timeline,
  timelineError,
}: {
  pullRequest: PullRequestData;
  timeline?: PullRequestTimelineItem[];
  timelineError: string;
}) {
  const failed = pullRequest.checks.filter((check) => check.state === "fail").length;
  const pending = pullRequest.checks.filter((check) => check.state === "pending").length;
  const passed = pullRequest.checks.filter((check) => check.state === "pass").length;
  const review = pullRequest.reviewDecision === "APPROVED"
    ? "Approved"
    : pullRequest.reviewDecision === "CHANGES_REQUESTED"
      ? "Changes requested"
      : "Review pending";
  const checks = failed > 0
    ? `${failed} failed`
    : pending > 0
      ? `${pending} pending`
      : pullRequest.checks.length > 0
        ? `${passed} passed`
        : "No checks";

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-4xl px-6 py-7 sm:px-8 lg:px-10 lg:py-9">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">{pullRequest.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{pullRequest.repository} · #{pullRequest.number}</p>

        <dl className="mt-8 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          <dt className="flex items-center gap-2 text-muted-foreground"><GitBranch className="size-4" />Branch</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate font-mono text-xs">{pullRequest.headRefName}</span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-xs">{pullRequest.baseRefName}</span>
            <span className="ml-1 font-mono text-xs tabular-nums">
              <span className="text-success-foreground">+{pullRequest.additions}</span>{" "}
              <span className="text-destructive">−{pullRequest.deletions}</span>
            </span>
          </dd>
          <dt className="flex items-center gap-2 text-muted-foreground"><MessageSquare className="size-4" />Review</dt>
          <dd>{review}</dd>
          <dt className="flex items-center gap-2 text-muted-foreground"><CircleCheck className="size-4" />Checks</dt>
          <dd>{checks}</dd>
          <dt className="flex items-center gap-2 text-muted-foreground"><GitPullRequest className="size-4" />Status</dt>
          <dd><PullRequestStateBadge pullRequest={pullRequest} /></dd>
        </dl>

        <section className="mt-9 border-t border-border pt-7">
          <h2 className="text-base font-semibold">Description</h2>
          <div className="mt-4">
            {pullRequest.body.trim() ? (
              <Markdown text={pullRequest.body} className="text-sm" />
            ) : (
              <p className="text-sm text-muted-foreground">No description.</p>
            )}
          </div>
        </section>

        <section className="mt-8 border-t border-border pt-5">
          <h2 className="text-sm font-medium">Recent activity</h2>
          <PullRequestActivity timeline={timeline} error={timelineError} />
        </section>

        {pullRequest.checks.length > 0 && (
          <section className="mt-8 border-t border-border pt-5">
            <h2 className="text-sm font-medium">Checks</h2>
            <ItemGroup className="mt-2 gap-0">
              {pullRequest.checks.map((check, index) => (
                <Item key={`${check.name}:${index}`} size="sm" className="min-h-0 rounded-none px-0 py-1.5">
                  <ItemMedia className="text-muted-foreground">{checkIcon(check.state)}</ItemMedia>
                  <ItemContent><ItemTitle className="text-xs font-normal">{check.name}</ItemTitle></ItemContent>
                  <span className={cn(
                    "text-[11px]",
                    check.state === "fail" ? "text-destructive" : check.state === "pending" ? "text-warning-foreground" : "text-muted-foreground",
                  )}>
                    {check.state === "pass" ? "Passed" : check.state === "fail" ? "Failed" : check.state === "pending" ? "Pending" : "Skipped"}
                  </span>
                </Item>
              ))}
            </ItemGroup>
          </section>
        )}
      </div>
    </ScrollArea>
  );
}

function checkIcon(state: PullRequestData["checks"][number]["state"]) {
  if (state === "pass") return <CircleCheck className="size-3.5 text-success-foreground" />;
  if (state === "fail") return <CircleX className="size-3.5 text-destructive" />;
  return <CircleDot className="size-3.5 text-muted-foreground" />;
}

function PullRequestActivity({ timeline, error }: { timeline?: PullRequestTimelineItem[]; error: string }) {
  if (error) {
    return <p className="mt-3 text-sm text-muted-foreground">{error}</p>;
  }
  if (!timeline) {
    return <div className="mt-3 flex flex-col gap-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-4/5" /></div>;
  }
  if (timeline.length === 0) {
    return <p className="mt-3 text-sm text-muted-foreground">No activity yet.</p>;
  }
  return (
    <MessageGroup className="relative mt-2 gap-0 before:absolute before:bottom-3 before:left-[0.4375rem] before:top-3 before:w-px before:bg-border">
      {timeline.map((item) => (
        <Message key={item.id} className="items-start gap-2.5 py-2">
          <span className="relative z-10 flex shrink-0 bg-background py-0.5 text-muted-foreground">
            {activityIcon(item)}
          </span>
          <MessageContent className="gap-1.5">
            <MessageHeader className="flex-wrap gap-x-2 gap-y-0.5 px-0">
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                data-link
                className="min-w-0 truncate text-foreground hover:underline"
              >
                {activityTitle(item)}
              </a>
              <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                {item.author} · {relativeDate(item.createdAt)}
              </span>
            </MessageHeader>
            {item.kind !== "commit" && item.body && (
              <Bubble variant="ghost" className="w-full">
                <BubbleContent className="w-full">
                  <Markdown
                    text={item.body}
                    className="text-xs text-muted-foreground [&_[data-slot=collapsible]]:overflow-visible [&_[data-slot=collapsible]]:rounded-none [&_[data-slot=collapsible]]:border-0 [&_[data-slot=collapsible-trigger]]:px-0 [&_[data-slot=collapsible-trigger]]:py-1 [&_[data-slot=collapsible-content]]:border-0 [&_[data-slot=collapsible-content]]:border-l [&_[data-slot=collapsible-content]]:border-border [&_[data-slot=collapsible-content]]:py-2 [&_[data-slot=collapsible-content]]:pr-0 [&_[data-slot=collapsible-content]]:pl-3"
                  />
                </BubbleContent>
              </Bubble>
            )}
          </MessageContent>
        </Message>
      ))}
    </MessageGroup>
  );
}

function activityIcon(item: PullRequestTimelineItem) {
  if (item.kind === "commit") return <GitCommitHorizontal className="size-3.5" />;
  if (item.kind === "review" && item.state === "APPROVED") return <CircleCheck className="size-3.5 text-success-foreground" />;
  if (item.kind === "review" && item.state === "CHANGES_REQUESTED") return <CircleX className="size-3.5 text-destructive" />;
  return <MessageSquare className="size-3.5" />;
}

function activityTitle(item: PullRequestTimelineItem): string {
  if (item.kind === "commit") return item.body.split("\n")[0] || item.sha?.slice(0, 7) || "Commit";
  if (item.kind === "review") return item.state === "APPROVED" ? "Approved" : item.state === "CHANGES_REQUESTED" ? "Requested changes" : "Reviewed";
  if (item.kind === "review_comment") return item.path ? `Commented on ${item.path}` : "Commented on the changes";
  return "Commented";
}

function relativeDate(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed)) return "Recently";
  const minutes = Math.max(0, Math.round(elapsed / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function PullRequestFiles({
  serverId,
  pullRequest,
  selection,
  selected,
  comment,
  codeReferences,
  interactive,
  onCommentChange,
  onSelectLine,
  onAddComment,
  onRemoveReference,
  markingViewed,
  onViewedChange,
}: {
  serverId: string;
  pullRequest: PullRequestData;
  selection?: Selection;
  selected?: { file: PullRequestDiffFile; lines: PullRequestDiffLine[]; startLine: number; endLine: number };
  comment: string;
  codeReferences: ChatCodeReference[];
  interactive: boolean;
  onCommentChange: (value: string) => void;
  onSelectLine: (event: MouseEvent, fileIndex: number, hunkIndex: number, lineIndex: number) => void;
  onAddComment: () => void;
  onRemoveReference?: (id: string) => void;
  markingViewed: ReadonlySet<string>;
  onViewedChange: (path: string, viewed: boolean) => void;
}) {
  const [openFiles, setOpenFiles] = useState<Set<string>>(() => new Set(pullRequest.files.map((file) => file.path)));
  const allOpen = pullRequest.files.every((file) => openFiles.has(file.path));
  const lineProgress = pullRequest.files.reduce((progress, file) => {
    const stat = pullRequestFileStat(file);
    const lines = stat.additions + stat.deletions;
    return {
      reviewed: progress.reviewed + (file.viewed ? lines : 0),
      total: progress.total + lines,
    };
  }, { reviewed: 0, total: 0 });

  useEffect(() => {
    setOpenFiles(new Set(pullRequest.files.map((file) => file.path)));
  }, [pullRequest.number, pullRequest.repository]);

  const setFileOpen = (path: string, open: boolean) => {
    setOpenFiles((current) => {
      const next = new Set(current);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  return (
    <div className="flex size-full min-h-0 flex-col">
      {codeReferences.length > 0 && (
        <AttachmentGroup className="shrink-0 border-b border-border px-3 py-2">
          {codeReferences.map((reference) => (
            <Attachment key={reference.id} size="sm" className="max-w-80">
              <AttachmentMedia><MessageSquarePlus /></AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{referenceLabel(reference)}</AttachmentTitle>
                <AttachmentDescription>{reference.comment}</AttachmentDescription>
              </AttachmentContent>
              {onRemoveReference && (
                <AttachmentActions>
                  <AttachmentAction aria-label={`Remove ${referenceLabel(reference)}`} onClick={() => onRemoveReference(reference.id)}>
                    <X />
                  </AttachmentAction>
                </AttachmentActions>
              )}
            </Attachment>
          ))}
        </AttachmentGroup>
      )}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground">
        <Files className="size-3.5" />
        <span>{pullRequest.files.length} {pullRequest.files.length === 1 ? "file" : "files"}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={() => setOpenFiles(allOpen ? new Set() : new Set(pullRequest.files.map((file) => file.path)))}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </Button>
        <span className="shrink-0 font-mono"><span className="text-success-foreground">+{pullRequest.additions}</span> <span className="text-destructive">−{pullRequest.deletions}</span></span>
      </div>
      <div className="relative min-h-0 flex-1">
        <ScrollArea className="size-full">
          {pullRequest.files.length === 0 ? (
            <Empty className="min-h-60">
              <EmptyHeader><EmptyTitle>No changed files</EmptyTitle><EmptyDescription>This pull request has no text changes.</EmptyDescription></EmptyHeader>
            </Empty>
          ) : (
            <div className="pb-20">
              {pullRequest.files.map((file, fileIndex) => (
                <PullRequestFile
                  key={`${serverId}:${pullRequest.headRefOid}:${pullRequest.baseRefOid}:${file.previousPath ?? ""}:${file.path}`}
                  serverId={serverId}
                  pullRequest={pullRequest}
                  file={file}
                  fileIndex={fileIndex}
                  open={openFiles.has(file.path)}
                  selection={selection}
                  interactive={interactive}
                  onSelectLine={onSelectLine}
                  onOpenChange={(open) => setFileOpen(file.path, open)}
                  markingViewed={markingViewed.has(file.path)}
                  canMarkViewed={Boolean(pullRequest.nodeId)}
                  onViewedChange={(viewed) => {
                    if (viewed) setFileOpen(file.path, false);
                    onViewedChange(file.path, viewed);
                  }}
                />
              ))}
            </div>
          )}
        </ScrollArea>
        {pullRequest.files.length > 0 && (
          <Item
            variant="floating"
            size="sm"
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute inset-x-3 bottom-3 mx-auto w-auto max-w-sm flex-nowrap"
          >
            <ItemContent className="gap-1.5">
              <ItemTitle className="w-full justify-between text-xs">
                <span>Review progress</span>
                <span className="tabular-nums text-muted-foreground">
                  {lineProgress.reviewed.toLocaleString()} of {lineProgress.total.toLocaleString()} lines reviewed
                </span>
              </ItemTitle>
              <Progress
                value={lineProgress.total > 0 ? (lineProgress.reviewed / lineProgress.total) * 100 : 0}
                aria-label="Lines reviewed"
              />
            </ItemContent>
          </Item>
        )}
      </div>
      {interactive && selected && (
        <div className="shrink-0 border-t border-border bg-background p-3">
          <InputGroup>
            <InputGroupTextarea
              value={comment}
              onChange={(event) => onCommentChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onAddComment();
                }
              }}
              placeholder="Add context for the agent."
              aria-label="Thread comment"
              className="min-h-16"
            />
            <InputGroupAddon align="block-end" className="border-t">
              <InputGroupText>{referenceLabel({ path: selected.file.path, startLine: selected.startLine, endLine: selected.endLine })}</InputGroupText>
              <InputGroupButton className="ml-auto" variant="default" disabled={!comment.trim()} onClick={onAddComment}>
                <MessageSquarePlus data-icon="inline-start" />
                Add to thread
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      )}
    </div>
  );
}

function PullRequestFile({
  serverId,
  pullRequest,
  file,
  fileIndex,
  open,
  selection,
  interactive,
  onSelectLine,
  onOpenChange,
  markingViewed,
  canMarkViewed,
  onViewedChange,
}: {
  serverId: string;
  pullRequest: PullRequestData;
  file: PullRequestDiffFile;
  fileIndex: number;
  open: boolean;
  selection?: Selection;
  interactive: boolean;
  onSelectLine: (event: MouseEvent, fileIndex: number, hunkIndex: number, lineIndex: number) => void;
  onOpenChange: (open: boolean) => void;
  markingViewed: boolean;
  canMarkViewed: boolean;
  onViewedChange: (viewed: boolean) => void;
}) {
  const stat = pullRequestFileStat(file);
  const reader = usePullRequestFileContent(serverId, pullRequest, file);
  const gaps = fileContextGaps(file);
  const checkboxId = useId();

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="group/file border-b border-border">
      <div className="flex min-w-0 items-center">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-none" aria-label={`${open ? "Collapse" : "Expand"} diff for ${file.path}`}>
            <ChevronRight className="transition-transform group-data-[state=open]/file:rotate-90" />
          </Button>
        </CollapsibleTrigger>
        <PullRequestFileButton file={file} url={pullRequest.url} reader={reader} />
        <span className="shrink-0 px-2 font-mono text-[10px] text-muted-foreground">
          <span className="text-success-foreground">+{stat.additions}</span> <span className="text-destructive">−{stat.deletions}</span>
        </span>
        <Field orientation="horizontal" className="w-auto shrink-0 gap-1.5 px-3">
          <Checkbox
            id={checkboxId}
            checked={Boolean(file.viewed)}
            disabled={!canMarkViewed || markingViewed}
            onCheckedChange={(checked) => onViewedChange(checked === true)}
          />
          <FieldLabel htmlFor={checkboxId} className="text-[11px] font-normal text-muted-foreground">Viewed</FieldLabel>
        </Field>
      </div>
      <CollapsibleContent>
        {file.previousPath && <div className="flex min-w-0 gap-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground"><span className="shrink-0">Renamed from</span><FilePathLabel path={file.previousPath} /></div>}
        {file.hunks.length === 0 ? (
          <p className="border-t border-border px-3 py-8 text-center text-xs text-muted-foreground">This file has no text preview.</p>
        ) : file.hunks.map((hunk, hunkIndex) => (
          <div key={`${hunk.header}:${hunkIndex}`} className="border-t border-border">
            {gaps[hunkIndex] && <PullRequestContextGap gap={gaps[hunkIndex]} path={file.path} reader={reader} />}
            <div className="bg-info/10 px-3 py-1.5 font-mono text-[10px] text-muted-foreground break-all">{hunk.header}</div>
            <div className="font-mono text-[11px] leading-5">
              {hunk.lines.map((line, lineIndex) => {
                const chosen = selection?.fileIndex === fileIndex
                  && selection.hunkIndex === hunkIndex
                  && lineIndex >= Math.min(selection.anchor, selection.focus)
                  && lineIndex <= Math.max(selection.anchor, selection.focus);
                return (
                  <PullRequestLine
                    key={`${line.oldLine}:${line.newLine}:${lineIndex}`}
                    line={line}
                    lineIndex={lineIndex}
                    chosen={chosen}
                    interactive={interactive}
                    onClick={(event) => onSelectLine(event, fileIndex, hunkIndex, lineIndex)}
                  />
                );
              })}
            </div>
          </div>
        ))}
        {file.hunks.length > 0 && gaps[file.hunks.length] && (
          <PullRequestContextGap gap={gaps[file.hunks.length]} path={file.path} reader={reader} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function pullRequestFileStat(file: PullRequestDiffFile): { additions: number; deletions: number } {
  return file.hunks.flatMap((hunk) => hunk.lines).reduce((result, line) => ({
    additions: result.additions + Number(line.kind === "add"),
    deletions: result.deletions + Number(line.kind === "del"),
  }), { additions: 0, deletions: 0 });
}

function PullRequestLine({
  line,
  lineIndex,
  chosen,
  interactive,
  onClick,
}: {
  line: PullRequestDiffLine;
  lineIndex: number;
  chosen: boolean;
  interactive: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const className = cn(
    "grid w-full grid-cols-[2.25rem_2.25rem_minmax(0,1fr)] text-left",
    line.kind === "add" && "bg-success/10",
    line.kind === "del" && "bg-destructive/10",
    chosen && "bg-primary/15 ring-1 ring-inset ring-primary/30",
    interactive && "hover:bg-accent",
  );
  const contents = (
    <>
      <span className="border-r border-border px-1.5 text-right text-muted-foreground select-none">{line.oldLine ?? ""}</span>
      <span className="border-r border-border px-1.5 text-right text-muted-foreground select-none">{line.newLine ?? ""}</span>
      <span className="whitespace-pre-wrap break-words px-2">
        <span className="mr-1 text-muted-foreground select-none">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}</span>
        {line.text || " "}
      </span>
    </>
  );
  if (!interactive) return <div className={className}>{contents}</div>;
  return (
    <button
      type="button"
      aria-label={`Select line ${line.newLine ?? line.oldLine ?? lineIndex + 1}`}
      aria-pressed={chosen}
      onClick={onClick}
      className={className}
    >
      {contents}
    </button>
  );
}

export function referenceLabel(reference: Pick<ChatCodeReference, "path" | "startLine" | "endLine">): string {
  const file = reference.path.split("/").at(-1) || reference.path;
  const range = reference.startLine === reference.endLine
    ? `L${reference.startLine}`
    : `L${reference.startLine}-${reference.endLine}`;
  return `${file} (${range})`;
}
