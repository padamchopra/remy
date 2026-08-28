import { useEffect, useId, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleX,
  ExternalLink,
  FileCode2,
  Files,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  MessageSquare,
  MessageSquarePlus,
  X,
} from "lucide-react";
import { Markdown } from "@/components/Markdown";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Message, MessageContent, MessageGroup, MessageHeader } from "@/components/ui/message";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type {
  ChatCodeReference,
  PullRequestDiff as PullRequestData,
  PullRequestDiffFile,
  PullRequestDiffLine,
  PullRequestTimelineItem,
} from "@/state/types";

interface Selection {
  fileIndex: number;
  hunkIndex: number;
  anchor: number;
  focus: number;
}

type PullRequestTab = "summary" | "code";

export function PullRequestView({
  serverId,
  repository,
  number,
  chatId,
  codeReferences = [],
  onAddReference,
  onRemoveReference,
  onPullRequestChanged,
  actions,
}: {
  serverId: string;
  repository?: string;
  number?: number;
  chatId?: string;
  codeReferences?: ChatCodeReference[];
  onAddReference?: (reference: ChatCodeReference) => void;
  onRemoveReference?: (id: string) => void;
  onPullRequestChanged?: () => void;
  actions?: ReactNode;
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

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setPullRequest(undefined);
    setTimeline(undefined);
    setTimelineError("");
    setSelection(undefined);
    setReviewServerId(serverId);
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

  if (loading) return <PullRequestLoading />;
  if (error || !pullRequest) {
    const title = chatId ? "No pull request yet" : "Couldn't load this pull request";
    const description = chatId
      ? "Open one for this branch, then refresh."
      : "Refresh the list and try again.";
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const changedFiles = pullRequest.changedFiles || pullRequest.files.length;

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as PullRequestTab)} className="size-full min-h-0 gap-0">
      <header className="shrink-0 border-b border-border">
        <div className="flex h-10 min-w-0 items-center gap-3 px-3">
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
        <TabsList
          variant="line"
          aria-label="Pull request views"
          className="h-9 w-full justify-start gap-0 rounded-none px-3 py-0"
        >
          <TabsTrigger value="summary" className="h-full flex-none rounded-none px-2 text-xs after:bottom-0">
            Summary
          </TabsTrigger>
          <TabsTrigger value="code" className="h-full flex-none rounded-none px-2 text-xs after:bottom-0">
            Code <span className="text-[11px] tabular-nums text-muted-foreground">{changedFiles}</span>
          </TabsTrigger>
        </TabsList>
      </header>

      <TabsContent value="summary" className="min-h-0 overflow-hidden">
        <PullRequestSummary pullRequest={pullRequest} timeline={timeline} timelineError={timelineError} />
      </TabsContent>
      <TabsContent value="code" className="min-h-0 overflow-hidden">
        <PullRequestFiles
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
    </Tabs>
  );
}

function PullRequestLoading() {
  return (
    <div className="size-full">
      <div className="border-b border-border">
        <div className="flex h-10 items-center gap-3 px-3">
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
                  key={`${file.previousPath ?? ""}:${file.path}`}
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
  const compact = compactFilePath(file.path);
  const checkboxId = useId();

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="group/file border-b border-border">
      <div className="flex min-w-0 items-center">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start rounded-none px-3 py-2 text-xs">
            <ChevronRight className="transition-transform group-data-[state=open]/file:rotate-90" />
            <FileCode2 />
            <span
              title={file.path}
              className="grid min-w-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-baseline gap-2 text-left font-mono"
            >
              <span className="truncate text-foreground">{compact.name}</span>
              <span className="truncate text-[10px] text-muted-foreground">{compact.directory}</span>
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
              <span className="text-success-foreground">+{stat.additions}</span> <span className="text-destructive">−{stat.deletions}</span>
            </span>
          </Button>
        </CollapsibleTrigger>
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
        {file.previousPath && <p className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">Renamed from {file.previousPath}</p>}
        {file.hunks.length === 0 ? (
          <p className="border-t border-border px-3 py-8 text-center text-xs text-muted-foreground">This file has no text preview.</p>
        ) : file.hunks.map((hunk, hunkIndex) => (
          <div key={`${hunk.header}:${hunkIndex}`} className="border-t border-border">
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

export function compactFilePath(path: string): { name: string; directory: string } {
  const segments = path.split("/").filter(Boolean);
  const name = segments.at(-1) ?? path;
  const directories = segments.slice(0, -1);
  if (directories.length === 0) return { name, directory: "" };
  if (directories.length <= 3) return { name, directory: `${directories.join("/")}/` };
  return {
    name,
    directory: `${directories.slice(0, 2).join("/")}/…/${directories.at(-1)}/`,
  };
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
