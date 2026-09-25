import { CircleCheck, CircleDot, CircleX, LoaderCircle } from "lucide-react";
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
