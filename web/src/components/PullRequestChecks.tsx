import { ChevronRight, CircleCheck, CircleDot, CircleX, LoaderCircle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible-base";
import { Item, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import {
  groupPullRequestChecks,
  pullRequestChecksSummary,
  type PullRequestCheck,
  type PullRequestCheckState,
} from "@/lib/pull-request-checks";

function CheckStateIcon({ state }: { state: PullRequestCheckState }) {
  if (state === "pass") return <CircleCheck className="size-3.5 text-success-foreground" />;
  if (state === "fail") return <CircleX className="size-3.5 text-destructive" />;
  if (state === "pending") return <LoaderCircle className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" />;
  return <CircleDot className="size-3.5 text-muted-foreground" />;
}

function CheckGroups({ checks }: { checks: readonly PullRequestCheck[] }) {
  return (
    <div className="flex flex-col gap-3">
      {groupPullRequestChecks(checks).map((group) => (
        <div key={group.state} data-slot="pull-request-check-group" data-check-state={group.state}>
          <h3 className="text-[11px] font-medium text-muted-foreground">{group.label}</h3>
          <ItemGroup className="mt-1">
            {group.checks.map((check, index) => (
              <Item key={`${check.name}:${index}`} size="sm" className="gap-2 px-0 py-1.5" data-slot="pull-request-check" data-check-state={check.state}>
                <ItemMedia><CheckStateIcon state={check.state} /></ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="w-full truncate font-normal" title={check.name}>{check.name}</ItemTitle>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        </div>
      ))}
    </div>
  );
}

/// Checks as one line that opens into the list. It starts open only when
/// something failed or is still running; a green run is a line you can read
/// and move past.
export function PullRequestChecksDisclosure({ checks }: { checks: readonly PullRequestCheck[] }) {
  const failing = checks.some((check) => check.state === "fail");
  const waiting = checks.some((check) => check.state === "pending");
  const summaryState: PullRequestCheckState = failing ? "fail" : waiting ? "pending" : checks.some((check) => check.state === "pass") ? "pass" : "skipping";
  return (
    <section data-slot="pull-request-checks" aria-label="Checks">
      <h2 className="text-xs font-medium text-muted-foreground">Checks</h2>
      {checks.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{pullRequestChecksSummary(checks)}</p>
      ) : (
        <Collapsible defaultOpen={failing || waiting} className="mt-1">
          <CollapsibleTrigger className="group/checks -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <CheckStateIcon state={summaryState} />
            <span className="min-w-0 flex-1 truncate">{pullRequestChecksSummary(checks)}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{checks.length}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[panel-open]/checks:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <CheckGroups checks={checks} />
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

/// Status list for a pull request. Hosted and Mac share this so the right
/// column is not a name dump.
export function PullRequestChecks({ checks }: { checks: readonly PullRequestCheck[] }) {
  const groups = groupPullRequestChecks(checks);
  return (
    <section data-slot="pull-request-checks" aria-label="Checks">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground">Checks</h2>
      <p className="mt-1 text-xs text-muted-foreground">{pullRequestChecksSummary(checks)}</p>
      {groups.length > 0 && (
        <div className="mt-2 flex flex-col gap-3">
          {groups.map((group) => (
            <div key={group.state} data-slot="pull-request-check-group" data-check-state={group.state}>
              <h3 className="text-[11px] font-medium text-muted-foreground">{group.label}</h3>
              <ItemGroup className="mt-1">
                {group.checks.map((check, index) => (
                  <Item
                    key={`${check.name}:${index}`}
                    size="sm"
                    className="gap-2 px-0 py-1.5"
                    data-slot="pull-request-check"
                    data-check-state={check.state}
                  >
                    <ItemMedia>
                      <CheckStateIcon state={check.state} />
                    </ItemMedia>
                    <ItemContent className="min-w-0">
                      <ItemTitle className="w-full truncate font-normal">{check.name}</ItemTitle>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
