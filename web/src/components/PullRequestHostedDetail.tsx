import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowRight, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Markdown } from "@/components/Markdown";
import { PaneHeader } from "@/components/PaneHeader";
import { PullRequestChecks } from "@/components/PullRequestChecks";
import { PullRequestStackInfo } from "@/components/PullRequestStackInfo";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { relativeDate } from "@/lib/relative-date";
import { cn } from "@/lib/utils";
import type { AuthoredPullRequest } from "@/components/PullRequests";

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

/// Checks sit in their own column when there is room and in the reading column
/// when there is not. Only one is mounted, so the page has one Checks region.
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

export function PullRequestHostedDetail({
  pullRequest,
  organizationId,
  canOpen,
  onOpen,
  onBack,
}: {
  pullRequest: AuthoredPullRequest;
  organizationId: string;
  canOpen: (number: number) => boolean;
  onOpen: (number: number) => void;
  onBack: () => void;
}) {
  const images = useSignedImages(organizationId, pullRequest.repository, pullRequest.number);
  const stack = pullRequest.stack;
  const wide = useWide();
  const checks = <PullRequestChecks checks={pullRequest.checks} />;
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PaneHeader
        sidebar
        crumbs={[
          { label: "Pull requests", onClick: onBack },
          { label: pullRequest.title },
        ]}
      >
        {stack && (
          <PullRequestStackInfo
            repository={pullRequest.repository}
            number={pullRequest.number}
            initialStack={stack}
            canOpen={canOpen}
            onOpen={onOpen}
          />
        )}
        <Button asChild variant="ghost" size="sm">
          <a href={pullRequest.url} target="_blank" rel="noreferrer" data-link>Open on GitHub</a>
        </Button>
      </PaneHeader>
      <div className="flex min-h-0 flex-1">
        <ScrollArea data-slot="pull-request-detail-body" className="min-h-0 min-w-0 flex-1">
          <article className="mx-auto w-full max-w-3xl px-6 py-6">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={pullRequest.isDraft ? "secondary" : "success"}>{pullRequest.isDraft ? "Draft" : "Open"}</Badge>
              <span>{pullRequest.repository} #{pullRequest.number}</span>
              <span>· Updated {relativeDate(pullRequest.updatedAt)}</span>
            </p>
            <h1 className="mt-3 text-2xl font-semibold leading-tight tracking-tight wrap-break-word">{pullRequest.title}</h1>
            <p className="mt-2 flex min-w-0 flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              <span className="min-w-0 break-all">{pullRequest.headRefName}</span>
              <ArrowRight className="size-3.5 shrink-0" />
              <span className="min-w-0 break-all">{pullRequest.baseRefName}</span>
              <span className="text-success-foreground">+{pullRequest.additions}</span>
              <span className="text-destructive">−{pullRequest.deletions}</span>
              {pullRequest.changedFiles ? <span>across {pullRequest.changedFiles} {pullRequest.changedFiles === 1 ? "file" : "files"}</span> : null}
            </p>
            {stack?.entries && stack.entries.length > 1 && (
              <section className="mt-8" aria-label={`Stack #${stack.number}`}>
                <h2 className="text-sm font-medium">Stack #{stack.number}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stack.position} of {stack.size} · Merge from the bottom up into {stack.baseRefName}
                </p>
                <ItemGroup className="mt-2 gap-0">
                  {stack.entries.map((entry) => {
                    const current = entry.number === pullRequest.number;
                    const inApp = !current && canOpen(entry.number);
                    const Icon = entry.state === "MERGED" ? GitMerge : entry.state === "CLOSED" ? GitPullRequestClosed : GitPullRequest;
                    const content = (
                      <>
                        <ItemMedia><Icon className="size-4 text-muted-foreground" /></ItemMedia>
                        <ItemContent className="min-w-0">
                          <ItemTitle className="w-full min-w-0 whitespace-normal wrap-break-word">
                            <span className="text-muted-foreground">#{entry.number}</span> {entry.title}
                          </ItemTitle>
                          <ItemDescription>
                            {entry.position} of {stack.size} · {entry.state === "MERGED" ? "Merged" : entry.state === "CLOSED" ? "Closed" : entry.isDraft ? "Draft" : "Open"}
                            {current ? " · This pull request" : ""}
                          </ItemDescription>
                        </ItemContent>
                        {!inApp && !current && <ExternalLink className="size-3 shrink-0 text-muted-foreground" />}
                      </>
                    );
                    return (
                      <Item key={entry.number} asChild size="sm" className={cn("min-w-0 px-2 py-2", current ? "bg-accent" : "hover:bg-accent/50")}>
                        {current ? (
                          <div aria-current="true">{content}</div>
                        ) : inApp ? (
                          <button type="button" data-link className="w-full text-left" onClick={() => onOpen(entry.number)}>{content}</button>
                        ) : (
                          <a href={`https://github.com/${pullRequest.repository}/pull/${entry.number}`} target="_blank" rel="noreferrer" data-link>{content}</a>
                        )}
                      </Item>
                    );
                  })}
                </ItemGroup>
              </section>
            )}
            {!wide && <div className="mt-8">{checks}</div>}
            <section className="mt-8">
              <h2 className="text-sm font-medium">Description</h2>
              <div className="mt-3 min-w-0">
                {pullRequest.body?.trim()
                  ? <Markdown text={pullRequest.body} images={images} className="text-sm" />
                  : <p className="text-sm text-muted-foreground">No description.</p>}
              </div>
            </section>
            {pullRequest.comments && pullRequest.comments.length > 0 && (
              <section className="mt-8">
                <h2 className="text-sm font-medium">Comments</h2>
                <div className="mt-3 flex flex-col gap-4">
                  {pullRequest.comments.map((comment, index) => (
                    <article key={comment.url || `${comment.author}:${index}`} className="flex min-w-0 flex-col gap-2">
                      <p className="text-xs text-muted-foreground">
                        {comment.author}{comment.createdAt ? ` · ${relativeDate(comment.createdAt)}` : ""}
                      </p>
                      <Markdown text={comment.body} className="text-sm" />
                    </article>
                  ))}
                </div>
              </section>
            )}
          </article>
        </ScrollArea>
        {wide && (
          <aside className="w-72 shrink-0 border-l border-border">
            <ScrollArea data-slot="pull-request-detail-aside" className="h-full">
              <div className="px-5 py-6">{checks}</div>
            </ScrollArea>
          </aside>
        )}
      </div>
    </main>
  );
}
