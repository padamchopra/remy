import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { FileCode2, GitPullRequest, MessageSquarePlus, X } from "lucide-react";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from "@/components/ui/input-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { apiError } from "@/lib/api-error";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type { ChatCodeReference, PullRequestDiff as PullRequestDiffData } from "@/state/types";

interface Selection {
  fileIndex: number;
  hunkIndex: number;
  anchor: number;
  focus: number;
}

export function PullRequestDiff({
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
  const [diff, setDiff] = useState<PullRequestDiffData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<Selection>();
  const [comment, setComment] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const path = chatId
      ? `/chats/${encodeURIComponent(chatId)}/pull-request-diff`
      : `/pull-requests/diff?repository=${encodeURIComponent(repository ?? "")}&number=${number ?? ""}`;
    void transport.request<{ diff: PullRequestDiffData }>(serverId, path)
      .then((response) => {
        if (current) setDiff(response.diff);
      })
      .catch((caught) => {
        if (current) setError(apiError(caught));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [chatId, number, repository, serverId]);

  const selected = useMemo(() => {
    if (!selection || !diff) return undefined;
    const file = diff.files[selection.fileIndex];
    const hunk = file?.hunks[selection.hunkIndex];
    if (!file || !hunk) return undefined;
    const start = Math.min(selection.anchor, selection.focus);
    const end = Math.max(selection.anchor, selection.focus);
    const lines = hunk.lines.slice(start, end + 1);
    const numbers = lines.map((line) => line.newLine ?? line.oldLine).filter((line): line is number => line !== null);
    if (numbers.length === 0) return undefined;
    return { file, lines, startLine: Math.min(...numbers), endLine: Math.max(...numbers) };
  }, [diff, selection]);

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

  if (loading) {
    return <div className="space-y-3 p-4"><Skeleton className="h-9 w-2/3" /><Skeleton className="h-48 w-full" /></div>;
  }
  if (error || !diff) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon"><GitPullRequest /></EmptyMedia>
          <EmptyTitle>No changes available</EmptyTitle>
          <EmptyDescription>{error || "This pull request has no changes to show."}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="flex min-w-0 shrink-0 items-center gap-2 border-b bg-muted/20 px-3 py-2">
        <GitPullRequest className="size-4 shrink-0" />
        <span className="truncate text-xs font-medium">{diff.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">#{diff.number}</span>
        {onAddReference && <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground sm:inline">Select a line, then Shift-click another.</span>}
      </div>
      {codeReferences.length > 0 && (
        <AttachmentGroup className="shrink-0 border-b px-3 py-2">
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
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {diff.files.length === 0 ? (
            <Empty className="min-h-60">
              <EmptyHeader><EmptyTitle>No changed files</EmptyTitle><EmptyDescription>This pull request has no text changes.</EmptyDescription></EmptyHeader>
            </Empty>
          ) : diff.files.map((file, fileIndex) => (
            <section key={`${file.previousPath ?? ""}:${file.path}`} className="overflow-hidden rounded-lg border bg-card">
              <header className="flex min-w-0 items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium">
                <FileCode2 className="size-3.5 shrink-0" />
                <span className="truncate">{file.path}</span>
                {file.previousPath && <span className="truncate text-muted-foreground">from {file.previousPath}</span>}
              </header>
              {file.hunks.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">This file has no text preview.</p>
              ) : file.hunks.map((hunk, hunkIndex) => (
                <div key={`${hunk.header}:${hunkIndex}`} className="overflow-x-auto">
                  <div className="border-b bg-info/10 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{hunk.header}</div>
                  <div className="min-w-max font-mono text-[11px] leading-5">
                    {hunk.lines.map((line, lineIndex) => {
                      const chosen = selection?.fileIndex === fileIndex
                        && selection.hunkIndex === hunkIndex
                        && lineIndex >= Math.min(selection.anchor, selection.focus)
                        && lineIndex <= Math.max(selection.anchor, selection.focus);
                      return (
                        <button
                          key={`${line.oldLine}:${line.newLine}:${lineIndex}`}
                          type="button"
                          aria-label={`Select line ${line.newLine ?? line.oldLine ?? lineIndex + 1}`}
                          aria-pressed={chosen}
                          disabled={!onAddReference}
                          onClick={(event) => selectLine(event, fileIndex, hunkIndex, lineIndex)}
                          className={cn(
                            "grid w-full grid-cols-[3rem_3rem_1.25rem_minmax(20rem,1fr)] text-left",
                            line.kind === "add" && "bg-emerald-500/10",
                            line.kind === "del" && "bg-destructive/10",
                            chosen && "bg-primary/15 ring-1 ring-inset ring-primary/30",
                            onAddReference && "hover:bg-accent",
                          )}
                        >
                          <span className="border-r px-2 text-right text-muted-foreground select-none">{line.oldLine ?? ""}</span>
                          <span className="border-r px-2 text-right text-muted-foreground select-none">{line.newLine ?? ""}</span>
                          <span className="text-center text-muted-foreground select-none">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}</span>
                          <span className="whitespace-pre pr-3">{line.text || " "}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </ScrollArea>
      {onAddReference && selected && (
        <div className="shrink-0 border-t bg-background p-3">
          <InputGroup>
            <InputGroupTextarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Add context for the agent."
              aria-label="Review comment"
              className="min-h-16"
            />
            <InputGroupAddon align="block-end" className="border-t">
              <InputGroupText>{referenceLabel({ path: selected.file.path, startLine: selected.startLine, endLine: selected.endLine })}</InputGroupText>
              <InputGroupButton className="ml-auto" variant="default" disabled={!comment.trim()} onClick={addComment}>
                Add to thread
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>
      )}
    </div>
  );
}

export function referenceLabel(reference: Pick<ChatCodeReference, "path" | "startLine" | "endLine">): string {
  const file = reference.path.split("/").at(-1) || reference.path;
  const range = reference.startLine === reference.endLine
    ? `L${reference.startLine}`
    : `L${reference.startLine}-${reference.endLine}`;
  return `${file} (${range})`;
}
