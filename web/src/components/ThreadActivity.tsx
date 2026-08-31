import { useState } from "react";
import { Bot, ChevronDown, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProviderMark } from "@/components/ProviderMark";
import { elapsedSince, useTicker } from "@/lib/elapsed";
import { activityRunning } from "@/lib/thread-activity";
import { cn } from "@/lib/utils";
import type { ThreadActivity } from "@/state/types";

const labels: Record<ThreadActivity["status"], string> = {
  running: "Running", waiting: "Waiting", idle: "Idle", completed: "Completed", failed: "Failed", stopped: "Stopped", unknown: "Status unavailable",
};

export function ThreadActivityTool({ activities, connected }: { activities: ThreadActivity[]; connected: boolean }) {
  const [showFinished, setShowFinished] = useState(false);
  const running = activities.filter(activityRunning).length;
  const finished = activities.filter((row) => !activityRunning(row) && row.status !== "unknown").length;
  const visible = activities.filter((row) => showFinished || activityRunning(row) || row.status === "unknown");
  return (
    <section aria-label="Running work" className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1">{running} running</span>
        {finished > 0 && <Button variant="ghost" size="sm" aria-pressed={showFinished} onClick={() => setShowFinished(!showFinished)}>{showFinished ? "Hide finished" : `Show finished (${finished})`}</Button>}
      </div>
      {!connected && <p role="status" className="px-4 py-2 text-xs text-muted-foreground">Your device is offline; activity may be out of date.</p>}
      {visible.length === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Terminal /></EmptyMedia>
            <EmptyTitle>No running work</EmptyTitle>
            <EmptyDescription>Ask your agent to delegate a task or run a command.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex min-w-0 flex-col gap-4 p-3">
            {(["subagent", "shell"] as const).map((kind) => {
              const rows = visible.filter((row) => row.kind === kind);
              return rows.length ? (
                <section key={kind} aria-label={kind === "subagent" ? "Subagents" : "Shells"}>
                  <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{kind === "subagent" ? "Subagents" : "Shells"} · {rows.length}</h3>
                  <ItemGroup className="gap-1">
                    {rows.map((row) => <ActivityRow key={row.id} activity={row} parent={activities.find((parent) => parent.id === row.parentId)} />)}
                  </ItemGroup>
                </section>
              ) : null;
            })}
          </div>
        </ScrollArea>
      )}
    </section>
  );
}

function ActivityRow({ activity, parent }: { activity: ThreadActivity; parent?: ThreadActivity }) {
  const [open, setOpen] = useState(false);
  const running = activityRunning(activity);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Item asChild size="sm" className="w-full min-w-0 flex-nowrap px-2 py-2 text-left hover:bg-accent/70">
          <button type="button" aria-label={`${activity.title}, ${labels[activity.status]}`}>
            <ItemMedia className={cn(activity.status === "failed" && "text-destructive")}>
              {activity.kind === "subagent" ? <Bot className="size-4" /> : <Terminal className="size-4" />}
            </ItemMedia>
            <ItemContent className="min-w-0 gap-1">
              <ItemTitle className="w-full min-w-0"><span className="truncate">{activity.title}</span></ItemTitle>
              <ItemDescription className={cn("line-clamp-none truncate text-xs", running && "shimmer")}>
                {activity.progress || labels[activity.status]}
              </ItemDescription>
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <ProviderMark provider={activity.provider} className="size-3 shrink-0" />
                <span className="truncate">{[activity.model, labels[activity.status], activity.background ? "Background" : undefined, activity.tokens !== undefined ? `${activity.tokens.toLocaleString()} tokens` : undefined, activity.toolCount !== undefined ? `${activity.toolCount} tools` : undefined].filter(Boolean).join(" · ")}</span>
              </span>
            </ItemContent>
            <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
              <ActivityElapsed activity={activity} />
              <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
            </span>
          </button>
        </Item>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 flex min-w-0 flex-col gap-2 border-l border-border px-3 py-2 text-xs">
          <p className="whitespace-pre-wrap wrap-anywhere">{activity.command ?? activity.title}</p>
          {parent && <p className="wrap-anywhere text-muted-foreground">From {parent.title}</p>}
          {activity.progress && activity.progress !== activity.output && <p className="whitespace-pre-wrap wrap-anywhere text-muted-foreground">{activity.progress}</p>}
          {activity.output ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap wrap-anywhere font-mono">{activity.output}</pre> : <p className="text-muted-foreground">No output yet.</p>}
          {activity.status === "unknown" && <p className="text-muted-foreground">Live status is unavailable; this work may still be running.</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ActivityElapsed({ activity }: { activity: ThreadActivity }) {
  const now = useTicker(activityRunning(activity));
  if (!activity.startedAt) return null;
  return <span className="tabular-nums">{elapsedSince(activity.startedAt, activityRunning(activity) ? now : activity.completedAt ?? activity.updatedAt)}</span>;
}
