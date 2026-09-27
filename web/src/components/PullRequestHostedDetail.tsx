import { lazy, useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  CircleDashed,
  CircleX,
  Copy,
  FileDiff,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar-base";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs-base";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip-base";
import { Deferred } from "@/components/Deferred";
import { GitHubMark } from "@/components/GitHubMark";
import { Markdown } from "@/components/Markdown";
import { PaneHeader } from "@/components/PaneHeader";
import { PullRequestChecksDisclosure } from "@/components/PullRequestChecks";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { relativeDate } from "@/lib/relative-date";
import { cn } from "@/lib/utils";
import type { AuthoredPullRequest } from "@/components/PullRequests";

// The diff is its own surface: nobody reading the summary downloads it.
const PullRequestHostedFiles = lazy(() => import("@/components/PullRequestHostedFiles").then((module) => ({ default: module.PullRequestHostedFiles })));

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

const WIDE = "(min-width: 1024px)";

/// The summary sits in its own column when there is room and under the title
/// when there is not. Only one is mounted, so the page has one of each region.
function useWide() {
  return useSyncExternalStore(
    (changed) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

function githubPullRequestNumber(href: string, repository: string): number | undefined {
  const match = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|issues)\/(\d+)\/?(?:[?#].*)?$/i.exec(href);
  if (!match || match[1]!.toLowerCase() !== repository.toLowerCase()) return undefined;
  return Number(match[2]);
}

function PullRequestState({ pullRequest }: { pullRequest: AuthoredPullRequest }) {
  if (pullRequest.state === "MERGED") return <Badge className="bg-violet-500/15 text-violet-700 dark:text-violet-300"><GitMerge />Merged</Badge>;
  if (pullRequest.state === "CLOSED") return <Badge variant="destructive"><GitPullRequestClosed />Closed</Badge>;
  if (pullRequest.isDraft) return <Badge variant="secondary"><GitPullRequestDraft />Draft</Badge>;
  return <Badge variant="success"><GitPullRequest />Open</Badge>;
}

function GitHubAvatar({ login, className }: { login: string; className?: string }) {
  return (
    <Avatar className={className}>
      <AvatarImage src={`https://github.com/${encodeURIComponent(login)}.png?size=64`} alt="" referrerPolicy="no-referrer" />
      <AvatarFallback>{login.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
}

function Person({ login, className }: { login: string; className?: string }) {
  return (
    <a
      href={`https://github.com/${encodeURIComponent(login)}`}
      target="_blank"
      rel="noreferrer"
      data-link
      className={cn("inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground hover:underline", className)}
    >
      <GitHubAvatar login={login} />
      <span className="truncate">{login}</span>
    </a>
  );
}

function CopyBranch({ branch }: { branch: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={copied ? "Branch name copied" : "Copy branch name"}
            onClick={() => void navigator.clipboard?.writeText(branch).then(() => setCopied(true), () => undefined)}
          />
        )}
      >
        {copied ? <Check className="text-success-foreground" /> : <Copy />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy branch name"}</TooltipContent>
    </Tooltip>
  );
}

function DiffStat({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  return (
    <span className={cn("font-mono tabular-nums", className)} aria-label={`${additions} additions, ${deletions} deletions`}>
      <span className="text-success-foreground">+{additions.toLocaleString()}</span>{" "}
      <span className="text-destructive">−{deletions.toLocaleString()}</span>
    </span>
  );
}

function filesLabel(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? "file" : "files"}`;
}

function SideSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={className}>
      <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

const DECISION: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};

const REVIEWER_STATE = {
  APPROVED: { label: "Approved", Icon: Check, className: "text-success-foreground" },
  CHANGES_REQUESTED: { label: "Changes requested", Icon: CircleX, className: "text-destructive" },
  COMMENTED: { label: "Commented", Icon: MessageSquare, className: "text-muted-foreground" },
  DISMISSED: { label: "Dismissed", Icon: CircleDashed, className: "text-muted-foreground" },
  REQUESTED: { label: "Waiting", Icon: CircleDashed, className: "text-muted-foreground" },
} as const;

function Reviewers({ pullRequest }: { pullRequest: AuthoredPullRequest }) {
  const reviewers = pullRequest.reviewers ?? [];
  const decision = DECISION[pullRequest.reviewDecision];
  if (!reviewers.length && !decision) return null;
  return (
    <SideSection title="Reviewers">
      {decision && <p className="text-sm">{decision}</p>}
      {reviewers.length > 0 && (
        <ul className={cn("flex flex-col gap-2", decision && "mt-2")}>
          {reviewers.map((reviewer) => {
            const state = REVIEWER_STATE[reviewer.state] ?? REVIEWER_STATE.REQUESTED;
            return (
              <li key={reviewer.login} className="flex min-w-0 items-center gap-2 text-sm">
                <Person login={reviewer.login} className="flex-1 font-normal" />
                <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", state.className)}>
                  <state.Icon className="size-3.5" />
                  {state.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SideSection>
  );
}

function Labels({ labels }: { labels: NonNullable<AuthoredPullRequest["labels"]> }) {
  if (!labels.length) return null;
  return (
    <SideSection title="Labels">
      <ul className="flex flex-wrap gap-1.5">
        {labels.map((label) => (
          <li key={label.name}>
            <Badge variant="outline" className="max-w-full font-normal">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted-foreground" style={label.color ? { backgroundColor: `#${label.color}` } : undefined} />
              <span className="truncate">{label.name}</span>
            </Badge>
          </li>
        ))}
      </ul>
    </SideSection>
  );
}

function Stack({ pullRequest, canOpen, onOpen }: {
  pullRequest: AuthoredPullRequest;
  canOpen: (number: number) => boolean;
  onOpen: (number: number) => void;
}) {
  const stack = pullRequest.stack;
  if (!stack?.entries || stack.entries.length < 2) return null;
  return (
    <SideSection title={`Stack #${stack.number}`}>
      <p className="text-xs text-muted-foreground">{stack.position} of {stack.size} · Merges into {stack.baseRefName} from the bottom up</p>
      <ItemGroup className="-mx-2 mt-1.5 gap-0">
        {stack.entries.map((entry) => {
          const current = entry.number === pullRequest.number;
          const inApp = !current && canOpen(entry.number);
          const Icon = entry.state === "MERGED" ? GitMerge : entry.state === "CLOSED" ? GitPullRequestClosed : entry.isDraft ? GitPullRequestDraft : GitPullRequest;
          const content = (
            <>
              <ItemMedia className="self-start pt-0.5"><Icon className={cn("size-3.5", entry.state === "MERGED" ? "text-violet-500" : "text-muted-foreground")} /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="line-clamp-2 w-full min-w-0 font-normal whitespace-normal wrap-break-word">
                  <span className="text-muted-foreground tabular-nums">#{entry.number}</span> {entry.title}
                </ItemTitle>
              </ItemContent>
            </>
          );
          const className = cn("min-w-0 gap-2 px-2 py-1.5", current ? "bg-accent" : "hover:bg-accent/50");
          return current ? (
            <Item key={entry.number} size="sm" className={className} aria-current="true">{content}</Item>
          ) : (
            <Item key={entry.number} asChild size="sm" className={className}>
              {inApp ? (
                <button type="button" data-link className="w-full text-left" onClick={() => onOpen(entry.number)}>{content}</button>
              ) : (
                <a href={`https://github.com/${pullRequest.repository}/pull/${entry.number}`} target="_blank" rel="noreferrer" data-link>{content}</a>
              )}
            </Item>
          );
        })}
      </ItemGroup>
    </SideSection>
  );
}

function FilesSummary({ pullRequest, onShow }: { pullRequest: AuthoredPullRequest; onShow: () => void }) {
  if (!pullRequest.changedFiles && !pullRequest.additions && !pullRequest.deletions) return null;
  return (
    <SideSection title="Files changed">
      <Item asChild size="sm" variant="outline" className="-mx-0 gap-2 px-3 py-2 hover:bg-accent/50">
        <button type="button" data-link className="w-full text-left" onClick={onShow}>
          <ItemMedia><FileDiff className="size-4 text-muted-foreground" /></ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="font-normal">{pullRequest.changedFiles ? filesLabel(pullRequest.changedFiles) : "Changes"}</ItemTitle>
          </ItemContent>
          <DiffStat additions={pullRequest.additions} deletions={pullRequest.deletions} className="shrink-0 text-xs" />
        </button>
      </Item>
    </SideSection>
  );
}

export function PullRequestHostedDetail({
  pullRequest,
  organizationId,
  canOpen,
  onOpen,
  view,
  onViewChange,
  onBack,
}: {
  pullRequest: AuthoredPullRequest;
  organizationId: string;
  canOpen: (number: number) => boolean;
  onOpen: (number: number) => void;
  view?: "files";
  onViewChange: (view?: "files") => void;
  onBack: () => void;
}) {
  const images = useSignedImages(organizationId, pullRequest.repository, pullRequest.number);
  const wide = useWide();
  const showFiles = useCallback(() => onViewChange("files"), [onViewChange]);
  // A reference to a pull request Remy has opens here; anything else is GitHub's.
  const openLink = useCallback((href: string) => {
    const number = githubPullRequestNumber(href, pullRequest.repository);
    if (number && number !== pullRequest.number && canOpen(number)) onOpen(number);
    else window.open(href, "_blank", "noopener,noreferrer");
  }, [canOpen, onOpen, pullRequest.number, pullRequest.repository]);
  const summary = (
    <div className="flex flex-col gap-6">
      <PullRequestChecksDisclosure checks={pullRequest.checks} />
      <Reviewers pullRequest={pullRequest} />
      <Labels labels={pullRequest.labels ?? []} />
      <Stack pullRequest={pullRequest} canOpen={canOpen} onOpen={onOpen} />
      <FilesSummary pullRequest={pullRequest} onShow={showFiles} />
    </div>
  );
  const comments = pullRequest.comments ?? [];
  return (
    <TooltipProvider>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PaneHeader
          sidebar
          crumbs={[
            { label: "Pull requests", onClick: onBack },
            { label: `${pullRequest.repository} #${pullRequest.number}` },
          ]}
        >
          <Tooltip>
            <TooltipTrigger
              render={(
                <a
                  href={pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  data-link
                  aria-label="Open on GitHub"
                  className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                />
              )}
            >
              <GitHubMark />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">Open on GitHub</TooltipContent>
          </Tooltip>
        </PaneHeader>
        <Tabs
          value={view ?? "overview"}
          onValueChange={(value) => onViewChange(value === "files" ? "files" : undefined)}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="shrink-0 border-b border-border px-4 sm:px-6">
            <TabsList aria-label="Pull request" className="-mb-px h-10 gap-1">
              <TabsTrigger
                value="overview"
                className="h-10 rounded-none border-b-2 border-transparent px-2 data-active:border-foreground data-active:bg-transparent data-active:text-foreground"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="files"
                className="h-10 rounded-none border-b-2 border-transparent px-2 data-active:border-foreground data-active:bg-transparent data-active:text-foreground"
              >
                Files changed
                {pullRequest.changedFiles ? (
                  <span className="rounded-full bg-muted px-1.5 text-[11px] leading-4 font-medium text-muted-foreground tabular-nums">{pullRequest.changedFiles.toLocaleString()}</span>
                ) : null}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="overview" keepMounted className="flex min-h-0 flex-1 data-hidden:hidden">
            <ScrollArea data-slot="pull-request-detail-body" className="min-h-0 min-w-0 flex-1" viewportProps={{ tabIndex: 0, "aria-label": "Pull request summary" }}>
              <article className="mx-auto w-full max-w-[46rem] px-4 pt-7 pb-16 sm:px-8">
                <header>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-muted-foreground">
                    <PullRequestState pullRequest={pullRequest} />
                    {pullRequest.authorLogin && <Person login={pullRequest.authorLogin} />}
                    <span>updated {relativeDate(pullRequest.updatedAt)}</span>
                  </div>
                  <h1 className="mt-3 text-2xl leading-tight font-semibold tracking-tight text-balance wrap-break-word">{pullRequest.title}</h1>
                  <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                    <span className="flex min-w-0 max-w-full items-center gap-1">
                      <code className="min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-foreground" title={pullRequest.headRefName}>{pullRequest.headRefName}</code>
                      <CopyBranch branch={pullRequest.headRefName} />
                      <ArrowRight className="size-3.5 shrink-0" aria-label="into" />
                      <code className="ml-1 min-w-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono" title={pullRequest.baseRefName}>{pullRequest.baseRefName}</code>
                    </span>
                    <button
                      type="button"
                      data-link
                      onClick={showFiles}
                      className="inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <DiffStat additions={pullRequest.additions} deletions={pullRequest.deletions} />
                      {pullRequest.changedFiles ? <span>in {filesLabel(pullRequest.changedFiles)}</span> : null}
                    </button>
                  </div>
                </header>
                {!wide && <div className="mt-6 rounded-xl border border-border p-4">{summary}</div>}
                <div data-slot="pull-request-description" className="mt-7 border-t border-border pt-7">
                  {pullRequest.body?.trim()
                    ? <Markdown text={pullRequest.body} images={images} repository={pullRequest.repository} onOpenLink={openLink} />
                    : <p className="text-sm text-muted-foreground">No description.</p>}
                </div>
                {comments.length > 0 && (
                  <section className="mt-10" aria-labelledby="pull-request-comments">
                    <h2 id="pull-request-comments" className="flex items-center gap-2 text-sm font-medium">
                      Comments <span className="text-muted-foreground tabular-nums">{comments.length}</span>
                    </h2>
                    <ol className="mt-3 flex flex-col gap-3">
                      {comments.map((comment, index) => (
                        <li key={comment.url || `${comment.author}:${index}`} className="min-w-0 rounded-xl border border-border px-4 py-3">
                          <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                            {comment.author ? <Person login={comment.author} /> : <span>Someone</span>}
                            {comment.createdAt && <span>{relativeDate(comment.createdAt)}</span>}
                          </p>
                          <Markdown text={comment.body} repository={pullRequest.repository} onOpenLink={openLink} className="mt-2" />
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </article>
            </ScrollArea>
            {wide && (
              <aside aria-label="Summary" className="w-80 shrink-0 border-l border-border">
                <ScrollArea data-slot="pull-request-detail-aside" className="h-full">
                  <div className="px-5 py-7">{summary}</div>
                </ScrollArea>
              </aside>
            )}
          </TabsContent>
          <TabsContent value="files" keepMounted className="flex min-h-0 flex-1 data-hidden:hidden">
            <Deferred open={view === "files"}>
              <PullRequestHostedFiles
                organizationId={organizationId}
                pullRequest={pullRequest}
                active={view === "files"}
              />
            </Deferred>
          </TabsContent>
        </Tabs>
      </main>
    </TooltipProvider>
  );
}
