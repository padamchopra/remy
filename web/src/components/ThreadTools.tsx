import { useState } from "react";
import { ArrowUpRight, ChevronDown, CircleAlert, CircleStop, Folder, MessagesSquare, Wrench } from "lucide-react";
import { organizationArtifactRoute, shownArtifacts, type ShownArtifact } from "@/lib/artifact-route";
import { navigateLocation } from "@/lib/route";
import type { ConvEntry } from "@/state/types";
import { ThreadDiff as Diff } from "@/components/ThreadDiff";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { cn } from "@/lib/utils";

const ARTIFACT_ICON = {
  thread: MessagesSquare,
  workspace: Folder,
} as const;

/// What a Remy tool just made, as a thing rather than a sentence.
function ArtifactCard({ artifact, onOpen }: { artifact: ShownArtifact; onOpen?: () => void }) {
  const organizationRoute = organizationArtifactRoute(artifact);
  if (organizationRoute) onOpen = () => navigateLocation({ route: organizationRoute });
  const Icon = ARTIFACT_ICON[artifact.kind];
  const body = (
    <>
      <ItemMedia variant="icon" className="size-7">
        <Icon className="size-3.5" />
      </ItemMedia>
      <ItemContent className="gap-0.5">
        <ItemTitle className="w-full whitespace-normal break-words">{artifact.title}</ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {artifact.detail && <span className="min-w-0 break-words">{artifact.detail}</span>}
        </ItemDescription>
      </ItemContent>
      {onOpen && (
        <ItemActions>
          <ArrowUpRight className="size-4 text-muted-foreground" />
        </ItemActions>
      )}
    </>
  );
  if (!onOpen) return <Item variant="outline" size="sm">{body}</Item>;
  return (
    <Item asChild variant="outline" size="sm" className="w-full text-left hover:bg-accent">
      <button type="button" data-link onClick={onOpen}>{body}</button>
    </Item>
  );
}

function ToolEntry({ entry }: { entry: ConvEntry }) {
  const status = toolStatus(entry);
  const failed = status === "error";
  const stopped = status === "stopped";
  const [expanded, setExpanded] = useState(false);
  const expandable = Boolean(entry.output || entry.diff?.length);
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-8 w-full min-w-0 justify-start rounded-lg px-2 font-normal hover:bg-transparent"
      aria-expanded={expandable ? expanded : undefined}
    >
      <Wrench data-icon="inline-start" className="shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium">{entry.verb ?? entry.tool ?? "Tool"}</span>
      {entry.arg && (
        <span className="min-w-0 flex-1 truncate text-left font-mono text-muted-foreground" title={entry.arg}>
          {entry.arg}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {typeof entry.adds === "number" && entry.adds > 0 && (
          <span className="font-mono text-success-foreground">+{entry.adds}</span>
        )}
        {typeof entry.dels === "number" && entry.dels > 0 && (
          <span className="font-mono text-destructive">−{entry.dels}</span>
        )}
        {failed && <Badge variant="destructive">Failed</Badge>}
        {stopped && <Badge variant="secondary">Stopped</Badge>}
        {expandable && (
          <ChevronDown data-icon="inline-end" className={cn("transition-transform", expanded && "rotate-180")} />
        )}
      </span>
    </Button>
  );
  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border text-xs",
        failed ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40",
      )}
    >
      {expandable ? <CollapsibleTrigger asChild>{trigger}</CollapsibleTrigger> : trigger}
      <CollapsibleContent>
        <div className="flex flex-col gap-1.5 px-3 pb-2">
          {entry.diff && entry.diff.length > 0 && <Diff lines={entry.diff} />}
          {entry.output && (
            <pre className="max-h-56 overflow-auto break-all whitespace-pre-wrap text-muted-foreground">
              {entry.output}
            </pre>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/// Consecutive tool calls are one passage. The reading column stays the words.
export function ToolGroup({
  entries,
  working,
  onOpenThread,
  onOpenWorkspace,
}: {
  entries: ConvEntry[];
  working: boolean;
  onOpenThread?: (id: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const failed = entries.filter((entry) => toolStatus(entry) === "error").length;
  const stopped = entries.filter((entry) => toolStatus(entry) === "stopped").length;
  return (
    <div className="flex flex-col gap-1.5">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <Marker asChild className="w-fit">
          <CollapsibleTrigger className="group/tool-group rounded-sm py-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <MarkerIcon className={failed > 0 ? "text-destructive" : undefined}>
              {failed > 0 ? <CircleAlert /> : stopped > 0 ? <CircleStop /> : <Wrench />}
            </MarkerIcon>
            <MarkerContent className={working ? "shimmer" : undefined}>{toolGroupSummary(entries)}</MarkerContent>
            {failed > 0 && <Badge variant="destructive">{failed} failed</Badge>}
            {stopped > 0 && (
              <Badge variant="secondary">{stopped === 1 ? "Stopped" : `${stopped} stopped`}</Badge>
            )}
            <ChevronDown className="transition-transform group-data-[state=open]/tool-group:rotate-180" />
          </CollapsibleTrigger>
        </Marker>
        <CollapsibleContent className="pt-2">
          <div className="ml-2 flex flex-col gap-1.5 border-l border-border pl-3">
            {entries.map((entry) => <ToolEntry key={entry.id} entry={entry} />)}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {entries.flatMap((entry) => shownArtifacts(entry.artifacts)).map((artifact, index) => (
        <ArtifactCard
          key={`${artifact.kind}:${artifact.id ?? index}`}
          artifact={artifact}
          onOpen={
            artifact.kind === "thread" && artifact.id && onOpenThread
              ? () => onOpenThread(artifact.id!)
              : artifact.kind === "workspace" && artifact.id && onOpenWorkspace
                ? () => onOpenWorkspace(artifact.id!)
                : undefined
          }
        />
      ))}
    </div>
  );
}

function toolStatus(entry: ConvEntry): ConvEntry["status"] {
  if (entry.status === "stopped") return "stopped";
  if (entry.status === "error" && /(?:\^C|SIGINT)\s*$/i.test(entry.output ?? "")) return "stopped";
  return entry.status;
}

function toolGroupSummary(entries: ConvEntry[]): string {
  const actions = entries.map((entry) => {
    const verb = entry.verb?.toLowerCase() ?? "";
    const tool = entry.tool?.toLowerCase() ?? "";
    if (tool.includes("browser")) return "used the browser";
    if (verb.includes("searched web") || tool.includes("websearch")) return "searched the web";
    if (["edited", "wrote"].some((value) => verb.includes(value)) || /apply_patch|write|edit/.test(tool)) return "edited files";
    if (["read", "searched", "globbed", "listed"].some((value) => verb.includes(value)) || /read|find|search|list|glob/.test(tool)) return "read files";
    if (verb.includes("ran") || /bash|exec|command|shell/.test(tool)) return "ran commands";
    if (verb.includes("skill")) return "loaded instructions";
    if (verb.includes("delegated")) return "delegated work";
    if (verb.includes("fetched")) return "fetched pages";
    return "used tools";
  });
  const unique = [...new Set(actions)];
  const summary = unique.length > 3
    ? `${unique.slice(0, 2).join(", ")}, and ${unique.length - 2} more`
    : unique.join(", ");
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}
