import type { ReactNode } from "react";
import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import { Item, ItemGroup } from "@/components/ui/item";
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

/// The icon a member leads with. The current open pull request is the one in
/// colour; a draft or a closed one recedes.
export function PullRequestStackIcon({ state, isDraft, current }: { state?: string; isDraft: boolean; current?: boolean }) {
  const Icon = state === "MERGED" ? GitMerge : state === "CLOSED" ? GitPullRequestClosed : GitPullRequest;
  const tone = current && state !== "MERGED" && state !== "CLOSED" && !isDraft
    ? "text-success-foreground"
    : isDraft || state === "CLOSED" ? "text-muted-foreground/60" : "text-muted-foreground";
  return <Icon aria-hidden className={cn("mt-[2.5px] size-[13px] shrink-0", tone)} />;
}

/// One member of a stack. Remy opens a member it has; GitHub has the rest.
export function PullRequestStackEntry({ repository, entry, size, current, canOpen, onOpen }: {
  repository: string;
  entry: { position: number; number: number; title: string; state: string; isDraft: boolean };
  size: number;
  current: boolean;
  canOpen?: (number: number) => boolean;
  onOpen?: (number: number) => void;
}) {
  const inApp = !current && !!onOpen && !!canOpen?.(entry.number);
  // A narrow box, like the summary column, puts the place in the stack under
  // the title rather than squeezing the title to a word.
  const content = (
    <>
      <PullRequestStackIcon state={entry.state} isDraft={entry.isDraft} current={current} />
      <span className="shrink-0 font-mono text-xs leading-[18px] text-muted-foreground tabular-nums">#{entry.number}</span>
      <span className="flex min-w-0 flex-1 flex-col @md:flex-row @md:items-start @md:gap-2.5">
        <span className={cn("line-clamp-2 min-w-0 flex-1 text-[13px] leading-[18px] wrap-break-word", current ? "text-foreground" : "text-foreground/75")}>
          {entry.title}
        </span>
        <span className={cn("shrink-0 text-xs leading-[18px] whitespace-nowrap", current ? "text-foreground/75" : "text-muted-foreground")}>
          {entry.position} of {size} · {pullRequestStackState(entry.state, entry.isDraft)}
        </span>
      </span>
      {!current && !inApp && <ExternalLink aria-label="Opens on GitHub" className="mt-[3px] size-3 shrink-0 text-muted-foreground" />}
    </>
  );
  const className = cn(ROW, "min-h-[42px] items-start py-3", current ? "bg-accent" : "hover:bg-accent/50");
  return (
    <PullRequestStackItem>
      {current ? (
        <Item data-slot="pull-request-stack-entry" size="sm" aria-current="true" className={className}>{content}</Item>
      ) : (
        <Item asChild size="sm" data-slot="pull-request-stack-entry" className={className}>
          {inApp ? (
            <button type="button" data-link className="w-full text-left" onClick={() => onOpen(entry.number)}>{content}</button>
          ) : (
            <a href={`https://github.com/${repository}/pull/${entry.number}`} target="_blank" rel="noreferrer" data-link>{content}</a>
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
