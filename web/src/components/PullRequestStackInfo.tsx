import { useEffect, useState } from "react";
import { ChevronDown, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTrigger } from "@/components/ui/popover-base";
import { PullRequestStackEntry, PullRequestStackHeader, PullRequestStackRows, stackEntriesInOrder } from "@/components/PullRequestStack";
import { transport } from "@/lib/transport";
import type { PullRequestStack } from "@/state/types";

/// Without a computer to ask, as in hosted Remy, the stack is what the list
/// already read from GitHub. A member Remy can open is opened in place.
export function PullRequestStackInfo({ serverId, repository, number, initialStack, canOpen, onOpen }: {
  serverId?: string;
  repository: string;
  number: number;
  initialStack?: PullRequestStack | null;
  canOpen?: (number: number) => boolean;
  onOpen?: (number: number) => void;
}) {
  const [stack, setStack] = useState(initialStack);
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!serverId) {
      setStack(initialStack);
      return;
    }
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
      if (["hello", "pull-requests"].includes(frame.type ?? "")) void read();
    }, ["pull-requests", "sidebar"]);
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
  // With a computer, its answer replaces the list's copy; without one, the
  // list's copy is the answer.
  }, [number, repository, retry, serverId, serverId ? undefined : initialStack]);

  if (!stack) return unavailable ? (
    <Button variant="ghost" size="sm" disabled={loading} onClick={() => setRetry((value) => value + 1)} aria-label="Retry stack information">
      <Layers data-icon="inline-start" /> Stack unavailable
    </Button>
  ) : null;

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" aria-label={`Stack #${stack.number}, ${stack.position} of ${stack.size}`} />}
      >
        <Layers data-icon="inline-start" />
        Stack #{stack.number}
        <span className="text-muted-foreground">· {stack.position} of {stack.size}</span>
        <ChevronDown data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex max-h-[min(60vh,var(--available-height))] w-[28rem] flex-col gap-2.5 overflow-y-auto p-3" aria-label={`Stack #${stack.number}`}>
        <PullRequestStackHeader
          number={stack.number}
          detail={`${stack.position} of ${stack.size} · Merge from the bottom up into ${stack.baseRefName}`}
        />
        {unavailable && <PopoverDescription className="text-xs">Stack information may be out of date.</PopoverDescription>}
        {stack.entries?.length ? (
          <PullRequestStackRows>
            {stackEntriesInOrder(stack.entries).map((entry) => (
              <PullRequestStackEntry
                key={entry.number}
                repository={repository}
                entry={entry}
                current={entry.number === number}
                canOpen={canOpen}
                onOpen={onOpen}
              />
            ))}
          </PullRequestStackRows>
        ) : null}
        {serverId && (!stack.entries || stack.entries.length < stack.size || unavailable) && (
          <Button variant="ghost" size="sm" className="self-start" disabled={loading} onClick={() => setRetry((value) => value + 1)}>Refresh stack</Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
