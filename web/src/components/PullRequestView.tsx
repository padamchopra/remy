import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type PullRequestTab = "summary" | "activity" | "files";

export function PullRequestView({
  serverId,
  repository,
  number,
  chatId,
  codeReferences = [],
  onAddReference,
  onRemoveReference,
}: {
  serverId: string;
  repository?: string;
  number?: number;
  chatId?: string;
  codeReferences?: ChatCodeReference[];
  onAddReference?: (reference: ChatCodeReference) => void;
  onRemoveReference?: (id: string) => void;
}) {
  const [pullRequest, setPullRequest] = useState<PullRequestData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<PullRequestTab>("summary");
  const [timeline, setTimeline] = useState<PullRequestTimelineItem[]>();
  const [timelineError, setTimelineError] = useState("");
  const [selection, setSelection] = useState<Selection>();
  const [comment, setComment] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setPullRequest(undefined);
    setTimeline(undefined);
    setTimelineError("");
    setSelection(undefined);
    const path = chatId
      ? `/chats/${encodeURIComponent(chatId)}/pull-request-diff`
      : `/pull-requests/diff?repository=${encodeURIComponent(repository ?? "")}&number=${number ?? ""}`;
    void transport.request<{ diff: PullRequestData }>(serverId, path)
      .then((response) => {
        if (current) setPullRequest(response.diff);
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
    if (tab !== "activity" || !pullRequest || timeline || timelineError) return;
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

  if (loading) return <PullRequestLoading />;
  if (error || !pullRequest) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
          <EmptyTitle>No pull request</EmptyTitle>
          <EmptyDescription>{error || "This branch does not have a pull request."}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const failed = pullRequest.checks.filter((check) => check.state === "fail").length;
  const pending = pullRequest.checks.filter((check) => check.state === "pending").length;
  const passed = pullRequest.checks.filter((check) => check.state === "pass").length;
  const changedFiles = pullRequest.changedFiles || pullRequest.files.length;

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as PullRequestTab)} className="size-full min-h-0 gap-0">
      <header className="shrink-0 border-b border-border">
        <div className="flex min-w-0 items-start gap-3 px-4 pb-3 pt-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
            <GitPullRequest className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{pullRequest.repository}</span>
              <span className="shrink-0">#{pullRequest.number}</span>
            </span>
            <h2 className="mt-1 text-sm font-semibold leading-snug">{pullRequest.title}</h2>
            <span className="mt-2 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{pullRequest.headRefName}</span>
              <ArrowRight className="size-3 shrink-0" />
              <span className="truncate">{pullRequest.baseRefName}</span>
            </span>
          </span>
          <Button asChild variant="ghost" size="icon-sm">
            <a href={pullRequest.url} target="_blank" rel="noreferrer" data-link aria-label="Open pull request on GitHub">
              <ExternalLink />
            </a>
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          <PullRequestStateBadge pullRequest={pullRequest} />
          {pullRequest.reviewDecision === "APPROVED" && <Badge variant="success"><CircleCheck />Approved</Badge>}
          {pullRequest.reviewDecision === "CHANGES_REQUESTED" && <Badge variant="destructive"><CircleX />Changes requested</Badge>}
          {failed > 0 ? (
            <Badge variant="destructive"><CircleX />{failed} failed</Badge>
          ) : pending > 0 ? (
            <Badge variant="warning"><CircleDot />{pending} pending</Badge>
          ) : pullRequest.checks.length > 0 ? (
            <Badge variant="outline"><CircleCheck />{passed}/{pullRequest.checks.length} checks</Badge>
          ) : null}
        </div>
        <TabsList variant="line" aria-label="Pull request views" className="h-9 w-full justify-start gap-3 rounded-none px-4 py-0">
          <TabsTrigger value="summary" className="flex-none px-0 after:bottom-0!">Summary</TabsTrigger>
          <TabsTrigger value="activity" className="flex-none px-0 after:bottom-0!">Activity</TabsTrigger>
          <TabsTrigger value="files" className="flex-none px-0 after:bottom-0!">Files {changedFiles}</TabsTrigger>
        </TabsList>
      </header>

      <TabsContent value="summary" className="min-h-0 overflow-hidden">
        <PullRequestSummary pullRequest={pullRequest} />
      </TabsContent>
      <TabsContent value="activity" className="min-h-0 overflow-hidden">
        <PullRequestActivity timeline={timeline} error={timelineError} />
      </TabsContent>
      <TabsContent value="files" className="min-h-0 overflow-hidden">
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
        />
      </TabsContent>
    </Tabs>
  );
}

function PullRequestLoading() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <span className="flex items-start gap-3">
        <Skeleton className="size-9 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-3 w-2/3" />
        </span>
      </span>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

function PullRequestStateBadge({ pullRequest }: { pullRequest: PullRequestData }) {
  if (pullRequest.state === "MERGED") return <Badge variant="info">Merged</Badge>;
  if (pullRequest.state === "CLOSED") return <Badge variant="secondary">Closed</Badge>;
  return <Badge variant={pullRequest.isDraft ? "secondary" : "success"}>{pullRequest.isDraft ? "Draft" : "Open"}</Badge>;
}

function PullRequestSummary({ pullRequest }: { pullRequest: PullRequestData }) {
  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-3">
        <Card className="gap-0 py-0 shadow-none">
          <CardHeader className="border-b border-border px-4 py-3">
            <CardTitle className="text-sm">Description</CardTitle>
          </CardHeader>
          <CardContent className="px-4 py-3">
            {pullRequest.body.trim() ? (
              <Markdown text={pullRequest.body} className="text-xs" />
            ) : (
              <p className="text-xs text-muted-foreground">No description.</p>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-none">
          <CardHeader className="border-b border-border px-4 py-3">
            <CardTitle className="text-sm">Changes</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 divide-x divide-border px-0 py-3 text-center">
            <PullRequestStat label="Files" value={pullRequest.changedFiles || pullRequest.files.length} />
            <PullRequestStat label="Added" value={`+${pullRequest.additions}`} tone="text-success-foreground" />
            <PullRequestStat label="Removed" value={`−${pullRequest.deletions}`} tone="text-destructive" />
          </CardContent>
        </Card>

        <Card className="gap-0 py-0 shadow-none">
          <CardHeader className="border-b border-border px-4 py-3">
            <CardTitle className="text-sm">Checks</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {pullRequest.checks.length > 0 ? (
              <ItemGroup>
                {pullRequest.checks.map((check) => (
                  <Item key={check.name} size="sm" className="rounded-none border-b border-border last:border-b-0">
                    <ItemMedia>{checkIcon(check.state)}</ItemMedia>
                    <ItemContent><ItemTitle>{check.name}</ItemTitle></ItemContent>
                    <Badge variant={check.state === "fail" ? "destructive" : check.state === "pending" ? "warning" : "outline"}>
                      {check.state === "pass" ? "Passed" : check.state === "fail" ? "Failed" : check.state === "pending" ? "Pending" : "Skipped"}
                    </Badge>
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <p className="px-4 py-3 text-xs text-muted-foreground">No checks reported.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}

function PullRequestStat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <span className="flex flex-col gap-0.5 px-2">
      <strong className={cn("text-sm font-semibold tabular-nums", tone)}>{value}</strong>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </span>
  );
}

function checkIcon(state: PullRequestData["checks"][number]["state"]) {
  if (state === "pass") return <CircleCheck className="text-success-foreground" />;
  if (state === "fail") return <CircleX className="text-destructive" />;
  return <CircleDot className="text-muted-foreground" />;
}

function PullRequestActivity({ timeline, error }: { timeline?: PullRequestTimelineItem[]; error: string }) {
  if (error) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon"><MessageSquare /></EmptyMedia>
          <EmptyTitle>Activity unavailable</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!timeline) {
    return <div className="flex flex-col gap-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  }
  if (timeline.length === 0) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon"><MessageSquare /></EmptyMedia>
          <EmptyTitle>No activity</EmptyTitle>
          <EmptyDescription>This pull request has no activity yet.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ScrollArea className="h-full">
      <ItemGroup className="gap-2 p-3">
        {timeline.map((item) => (
          <Item key={item.id} asChild variant="outline" size="sm" className="items-start">
            <a href={item.url} target="_blank" rel="noreferrer" data-link>
              <ItemMedia variant="icon">{item.kind === "commit" ? <GitCommitHorizontal /> : <MessageSquare />}</ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="max-w-full">
                  <span className="truncate">{activityTitle(item)}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </ItemTitle>
                {item.kind !== "commit" && item.body && (
                  <ItemDescription className="line-clamp-3 whitespace-pre-wrap text-xs">{item.body}</ItemDescription>
                )}
                <span className="text-[11px] text-muted-foreground">{item.author} · {relativeDate(item.createdAt)}</span>
              </ItemContent>
            </a>
          </Item>
        ))}
      </ItemGroup>
    </ScrollArea>
  );
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
}) {
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
        <span className="ml-auto font-mono"><span className="text-success-foreground">+{pullRequest.additions}</span> <span className="text-destructive">−{pullRequest.deletions}</span></span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {pullRequest.files.length === 0 ? (
          <Empty className="min-h-60">
            <EmptyHeader><EmptyTitle>No changed files</EmptyTitle><EmptyDescription>This pull request has no text changes.</EmptyDescription></EmptyHeader>
          </Empty>
        ) : (
          <div>
            {pullRequest.files.map((file, fileIndex) => (
              <PullRequestFile
                key={`${file.previousPath ?? ""}:${file.path}`}
                file={file}
                fileIndex={fileIndex}
                defaultOpen={fileIndex === 0}
                selection={selection}
                interactive={interactive}
                onSelectLine={onSelectLine}
              />
            ))}
          </div>
        )}
      </ScrollArea>
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
  defaultOpen,
  selection,
  interactive,
  onSelectLine,
}: {
  file: PullRequestDiffFile;
  fileIndex: number;
  defaultOpen: boolean;
  selection?: Selection;
  interactive: boolean;
  onSelectLine: (event: MouseEvent, fileIndex: number, hunkIndex: number, lineIndex: number) => void;
}) {
  const stat = file.hunks.flatMap((hunk) => hunk.lines).reduce((result, line) => ({
    additions: result.additions + Number(line.kind === "add"),
    deletions: result.deletions + Number(line.kind === "del"),
  }), { additions: 0, deletions: 0 });

  return (
    <Collapsible defaultOpen={defaultOpen} className="group/file border-b border-border">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="h-auto w-full justify-start rounded-none px-3 py-2 text-xs">
          <ChevronRight className="transition-transform group-data-[state=open]/file:rotate-90" />
          <FileCode2 />
          <span className="min-w-0 flex-1 truncate text-left font-mono">{file.path}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            <span className="text-success-foreground">+{stat.additions}</span> <span className="text-destructive">−{stat.deletions}</span>
          </span>
        </Button>
      </CollapsibleTrigger>
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
