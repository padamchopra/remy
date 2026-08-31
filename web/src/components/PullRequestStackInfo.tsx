import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { transport } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type { PullRequestStack } from "@/state/types";

export function PullRequestStackInfo({ serverId, repository, number, initialStack }: {
  serverId: string;
  repository: string;
  number: number;
  initialStack?: PullRequestStack | null;
}) {
  const [stack, setStack] = useState(initialStack);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    let pending = false;
    const read = async () => {
      if (pending || document.hidden) return;
      pending = true;
      setLoading(true);
      try {
        const params = new URLSearchParams({ repository, number: String(number) });
        const response = await transport.request<{ stack: PullRequestStack | null }>(serverId, `/pull-requests/stack?${params}`);
        if (current) { setStack(response.stack); setUnavailable(false); }
      } catch {
        if (current) setUnavailable(true);
      } finally { pending = false; if (current) setLoading(false); }
    };
    void read();
    // GitHub has no push connection here; refresh only stack metadata while visible.
    const timer = window.setInterval(() => void read(), 60_000);
    const onVisible = () => { if (!document.hidden) void read(); };
    document.addEventListener("visibilitychange", onVisible);
    const offPush = transport.subscribe((source, payload) => {
      if (source !== serverId || !payload || typeof payload !== "object") return;
      const frame = payload as { type?: string };
      if (frame.type === "peer-disconnected") setUnavailable(true);
      if (["hello", "peer-reset", "pull-requests"].includes(frame.type ?? "")) void read();
    });
    const offStatus = transport.onStatus((source, online) => {
      if (source !== serverId) return;
      if (online) void read();
      else setUnavailable(true);
    });
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      offPush(); offStatus();
    };
  }, [number, repository, retry, serverId]);

  if (!stack) return unavailable ? (
    <Button variant="ghost" size="sm" disabled={loading} onClick={() => setRetry((value) => value + 1)} aria-label="Retry stack information">
      <Layers data-icon="inline-start" /> Stack unavailable
    </Button>
  ) : null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Stack #${stack.number}, ${stack.position} of ${stack.size}`}>
          <Layers data-icon="inline-start" />
          Stack #{stack.number}
          <span className="text-muted-foreground">· {stack.position} of {stack.size}</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[60vh] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto p-2" aria-label={`Stack #${stack.number}`}>
        <PopoverHeader className="px-2 py-2">
          <PopoverTitle>Stack #{stack.number}</PopoverTitle>
          <PopoverDescription className="break-words">Bottom to top · Targets {stack.baseRefName}</PopoverDescription>
          {unavailable && <p role="status" className="text-xs text-muted-foreground">Stack information may be out of date.</p>}
        </PopoverHeader>
        <ItemGroup className="gap-0">
          {stack.entries?.map((entry) => {
            const Icon = entry.state === "MERGED" ? GitMerge : entry.state === "CLOSED" ? GitPullRequestClosed : GitPullRequest;
            return (
              <Item key={entry.number} asChild size="sm" className={cn("min-w-0 px-2 py-2", entry.number === number && "bg-accent")}>
                <a href={`https://github.com/${repository}/pull/${entry.number}`} target="_blank" rel="noreferrer" data-link aria-current={entry.number === number ? "true" : undefined}>
                  <ItemMedia><Icon /></ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="w-full min-w-0 whitespace-normal break-words">#{entry.number} {entry.title}</ItemTitle>
                    <ItemDescription>
                      {entry.position} of {stack.size} · {entry.state === "MERGED" ? "Merged" : entry.state === "CLOSED" ? "Closed" : entry.isDraft ? "Draft" : "Open"}{entry.number === number ? " · Current PR" : ""}
                    </ItemDescription>
                  </ItemContent>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                </a>
              </Item>
            );
          })}
        </ItemGroup>
        {(!stack.entries || stack.entries.length < stack.size || unavailable) && (
          <Button variant="ghost" size="sm" disabled={loading} onClick={() => setRetry((value) => value + 1)}>Refresh stack</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
