import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { FilePathLabel, PullRequestContextGap, PullRequestFileButton, usePullRequestFileContent } from "@/components/PullRequestFileContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { fileContextGaps } from "@/lib/pull-request-context";
import { pullRequestFileStat } from "@/lib/pull-request-guide-files";
import type { PullRequestDiff, PullRequestDiffFile, PullRequestDiffHunk } from "@/state/types";

/// Code and Guide share file controls; only the rendered hunk content differs.
export function PullRequestFileDiff({ serverId, pullRequest, file, open, onOpenChange, markingViewed, canMarkViewed, onViewedChange, visibleHunks, revisionError, renderHunk }: {
  serverId: string;
  pullRequest: PullRequestDiff;
  file: PullRequestDiffFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  markingViewed: boolean;
  canMarkViewed: boolean;
  onViewedChange: (viewed: boolean) => void;
  visibleHunks?: ReadonlySet<number>;
  revisionError?: string;
  renderHunk: (hunk: PullRequestDiffHunk, index: number) => ReactNode;
}) {
  const reader = usePullRequestFileContent(serverId, pullRequest, file, revisionError);
  const gaps = fileContextGaps(file);
  const checkboxId = useId();
  const shown = (index: number) => index < file.hunks.length && (!visibleHunks || visibleHunks.has(index));
  const stat = pullRequestFileStat({ ...file, hunks: file.hunks.filter((_, index) => shown(index)) });
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="group/file min-w-0 border-b border-border">
      <div className="flex min-w-0 items-center">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-none" aria-label={`${open ? "Collapse" : "Expand"} diff for ${file.path}`}>
            <ChevronRight className="transition-transform group-data-[state=open]/file:rotate-90" />
          </Button>
        </CollapsibleTrigger>
        <PullRequestFileButton file={file} url={pullRequest.url} reader={reader} />
        <span className="shrink-0 px-2 font-mono text-[10px] text-muted-foreground" aria-label={`${stat.additions} additions, ${stat.deletions} deletions`}>
          <span className="text-success-foreground">+{stat.additions}</span> <span className="text-destructive">−{stat.deletions}</span>
        </span>
        <Field orientation="horizontal" className="w-auto shrink-0 gap-1.5 px-3">
          <Checkbox id={checkboxId} checked={Boolean(file.viewed)} disabled={!canMarkViewed || markingViewed}
            aria-label={`Mark ${file.path} viewed`} onCheckedChange={(checked) => onViewedChange(checked === true)} />
          <FieldLabel htmlFor={checkboxId} className="text-[11px] font-normal text-muted-foreground">Viewed</FieldLabel>
        </Field>
      </div>
      <CollapsibleContent>
        {file.previousPath && <div className="flex min-w-0 gap-1 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground"><span className="shrink-0">Renamed from</span><FilePathLabel path={file.previousPath} /></div>}
        {file.hunks.length === 0 ? <p className="border-t border-border px-3 py-8 text-center text-xs text-muted-foreground">This file has no text preview.</p> : file.hunks.map((hunk, index) => shown(index) && (
          <div key={`${hunk.header}:${index}`} className="border-t border-border">
            {gaps[index] && <PullRequestContextGap gap={gaps[index]} path={file.path} reader={reader} />}
            <div className="bg-info/10 px-3 py-1.5 font-mono text-[10px] text-muted-foreground break-all">{hunk.header}</div>
            <div className="font-mono text-[11px] leading-5">{renderHunk(hunk, index)}</div>
            {!shown(index + 1) && gaps[index + 1] && <PullRequestContextGap gap={gaps[index + 1]} path={file.path} reader={reader} />}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
