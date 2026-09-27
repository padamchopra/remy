import type { ReactNode } from "react";
import { GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import { Item, ItemGroup } from "@/components/ui/item";
import { stackEntryStatus } from "@/lib/pull-request-detail";
import { cn } from "@/lib/utils";

/// What a stack member is, in the words a row ends with.
export function pullRequestStackState(state: string | undefined, isDraft: boolean) {
  return state === "MERGED" ? "Merged" : state === "CLOSED" ? "Closed" : isDraft ? "Draft" : "Open";
}

/// The line above a stack: its number, and on the right how it lands.
export function PullRequestStackHeader({ number, detail, children, className }: {
  number: number;
  detail: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div data-slot="pull-request-stack-header" className={cn("flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5", className)}>
      <span className="flex min-w-0 items-center gap-2">
        <h2 className="shrink-0 text-sm leading-5 font-medium text-foreground">Stack #{number}</h2>
        {children}
      </span>
      <span className="min-w-0 text-[13px] leading-5 text-muted-foreground">{detail}</span>
    </div>
  );
}

/// The members, bottom of the stack first, in one bordered box.
export function PullRequestStackRows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ItemGroup data-slot="pull-request-stack-rows" className={cn("@container gap-0 overflow-clip rounded-[10px] border border-border", className)}>
      {children}
    </ItemGroup>
  );
}

const ROW = "min-w-0 flex-nowrap gap-2.5 rounded-none border-0 px-3.5 py-2 focus-visible:ring-inset";

/// A row's place in the box; the rule between rows is the box's, not the row's.
export function PullRequestStackItem({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="listitem" className={cn("min-w-0 border-b border-border last:border-b-0", className)}>{children}</div>;
}

/// The icon a member leads with, in its state's colour: an open one is green,
/// a merged one violet, and a draft or a closed one recedes.
export function PullRequestStackIcon({ state, isDraft, className }: { state?: string; isDraft: boolean; className?: string }) {
  const Icon = state === "MERGED" ? GitMerge : state === "CLOSED" ? GitPullRequestClosed : GitPullRequest;
  const tone = state === "MERGED"
    ? "text-violet-600 dark:text-violet-400"
    : isDraft || state === "CLOSED" ? "text-muted-foreground/60" : "text-success-foreground";
  return <Icon aria-hidden className={cn("mt-[2.5px] size-[13px] shrink-0", tone, className)} />;
}

/// One member of a stack, drawn as the summary draws it: icon, number, title,
/// and on the right only what matters — here, a conflict, or how it ended.
/// Remy opens a member it has; GitHub has the rest.
export function PullRequestStackEntry({ repository, entry, current, mergeable, canOpen, onOpen }: {
  repository: string;
  entry: { position: number; number: number; title: string; state: string; isDraft: boolean };
  current: boolean;
  /// GitHub's word for whether this member merges cleanly, when it was read.
  mergeable?: string;
  canOpen?: (number: number) => boolean;
  onOpen?: (number: number) => void;
}) {
  const inApp = !current && !!onOpen && !!canOpen?.(entry.number);
  const status = stackEntryStatus(entry, current, mergeable);
  const content = (
    <>
      <PullRequestStackIcon state={entry.state} isDraft={entry.isDraft} className="mt-0 size-3.5" />
      <span className="shrink-0 font-mono text-[11px] leading-4 text-muted-foreground tabular-nums">#{entry.number}</span>
      <span
        data-slot="pull-request-title"
        className={cn("min-w-0 flex-1 truncate text-xs leading-[18px]", current ? "font-medium text-foreground" : "text-foreground/75")}
        title={entry.title}
      >
        {entry.title}
      </span>
      {status && (
        <span className={cn("shrink-0 text-[11px] leading-4", status.tone === "destructive" ? "text-destructive" : "text-muted-foreground")}>
          {status.label}
        </span>
      )}
    </>
  );
  const className = cn(ROW, "min-h-[38px] items-center gap-2.5 px-3 py-2.5", current ? "bg-accent" : "hover:bg-accent/50");
  return (
    <PullRequestStackItem>
      {current ? (
        <Item data-slot="pull-request-stack-entry" size="sm" aria-current="true" className={className}>{content}</Item>
      ) : (
        <Item asChild size="sm" data-slot="pull-request-stack-entry" className={className}>
          {inApp ? (
            <button type="button" data-link className="w-full text-left" onClick={() => onOpen(entry.number)}>{content}</button>
          ) : (
            <a href={`https://github.com/${repository}/pull/${entry.number}`} target="_blank" rel="noreferrer" data-link aria-label={`#${entry.number} ${entry.title}, on GitHub`}>{content}</a>
          )}
        </Item>
      )}
    </PullRequestStackItem>
  );
}

/// Bottom of the stack first, whatever order GitHub listed them in.
export function stackEntriesInOrder<T extends { position: number }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => a.position - b.position);
}
