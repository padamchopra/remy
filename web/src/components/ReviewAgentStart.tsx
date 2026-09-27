import { useCallback, useEffect, useState } from "react";
import { Book, ChevronDown, Cloud, Laptop } from "lucide-react";
import { CURSOR_CLOUD_COMPUTER_ID, type ComputerSummary, type ThreadMember } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuGroup, MenuGroupLabel, MenuItem, MenuItemCheck, MenuTrigger } from "@/components/ui/menu-base";
import { PopoverDescription, PopoverTitle } from "@/components/ui/popover-base";
import { ModelPickerButton } from "@/components/ModelPicker";
import type { ModelAccessResponse } from "@/components/HubModelAccess";
import { startHubThread } from "@/lib/hub-thread-start";
import { useHubStartChoice, type StartPreference } from "@/lib/hub-start-choice";
import { useHubResource } from "@/lib/hub-organization";
import { watchHubComputers } from "@/lib/hub-computers";
import { watchHubThreads } from "@/lib/hub-threads";
import { navigateLocation } from "@/lib/route";
import { readLastReviewChoice, repositoryName, reviewStartMessage, rulesApplyLine, type ReviewRule } from "@/lib/review-agent";
import { useReviewRules } from "@/lib/review-agent-data";
import { cn } from "@/lib/utils";

/// A pull request a review can start on.
export interface ReviewTarget {
  organizationId: string;
  workspaceId: string;
  repository: string;
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
}

const FIELD = "flex h-[30px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-foreground/10 bg-background/45 px-2.5 text-left text-xs leading-4 font-normal text-foreground shadow-none outline-none hover:bg-background/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-background/45 [&_svg]:shrink-0";
const OUTLINE = "h-[30px] rounded-lg border-foreground/10 bg-transparent px-3 text-xs font-normal text-foreground/70 shadow-none hover:text-foreground dark:bg-transparent";
const PRIMARY = "h-[30px] rounded-lg px-3.5 text-xs font-semibold";

/// Cursor Cloud runs without Remy's tools, so it cannot report findings; the
/// hub refuses a review there too.
const cursorCloud = (computerId: string) =>
  computerId === CURSOR_CLOUD_COMPUTER_ID ? "Runs without the review agent's tools" : undefined;

function useStartContext(organizationId: string) {
  const [computers, setComputers] = useState<ComputerSummary[]>([]);
  const [computersLoaded, setComputersLoaded] = useState(false);
  const [member, setMember] = useState<ThreadMember>();
  useEffect(() => {
    const offComputers = watchHubComputers(organizationId, (items, stale) => {
      setComputers(items);
      if (!stale) setComputersLoaded(true);
    }, () => setComputersLoaded(true));
    const offThreads = watchHubThreads(organizationId, (_, current) => setMember(current), () => undefined);
    return () => { offComputers(); offThreads(); };
  }, [organizationId]);
  return { computers, computersLoaded, member };
}

/// The Start review popover's body: the same computers and models a thread in
/// this workspace could start on, defaulting to what you last reviewed with
/// here, an optional focus, and the rules that will apply. Start review
/// starts an ordinary hosted thread with the pull request attached; its
/// progress and any failure show in the review agent pane.
export function ReviewAgentStart({
  target,
  rules: given,
  onViewRules,
  onCancel,
  onStarted,
}: {
  target: ReviewTarget;
  rules?: ReviewRule[];
  onViewRules: () => void;
  onCancel: () => void;
  onStarted: (requestId: string) => void;
}) {
  const { organizationId, workspaceId, repository } = target;
  const { computers, computersLoaded, member } = useStartContext(organizationId);
  // The pane may already hold your rules; otherwise the popover reads them.
  const read = useReviewRules(organizationId, repository, given === undefined);
  const rules = given ?? read.rules;
  const catalogue = useHubResource<{ workspaces: { id: string; name: string; origin: string }[] }>(organizationId, "/workspaces");
  const workspace = catalogue.value?.workspaces.find((entry) => entry.id === workspaceId);
  const [last, setLast] = useState<StartPreference | null | "loading">("loading");
  useEffect(() => {
    let current = true;
    setLast("loading");
    readLastReviewChoice(organizationId, workspaceId)
      .then((value) => { if (current) setLast(value); })
      // No earlier review, or a hub without the read: the thread default applies.
      .catch(() => { if (current) setLast(null); });
    return () => { current = false; };
  }, [organizationId, workspaceId]);
  const exclude = useCallback(cursorCloud, []);
  const choice = useHubStartChoice({
    organizationId, memberId: member?.id, computers, computersLoaded, workspaceId,
    workspaceOrigin: workspace?.origin, preferred: last, exclude,
  });
  const [focus, setFocus] = useState("");
  const access = useHubResource<ModelAccessResponse>(organizationId, "/model-access");
  const name = workspace?.name ?? repositoryName(repository);
  const cloudAccess = (access.value?.providers ?? []).some((entry) => entry.enabled && entry.configured);
  const nothing = choice.optionsKnown && !!access.value && choice.eligible.length === 0 && (choice.cloudOptions.length === 0 || !cloudAccess);
  const [requestId] = useState(() => crypto.randomUUID());

  const start = () => {
    if (!member || !choice.canStart || !workspace) return;
    const message = reviewStartMessage({ number: target.number, title: target.title, headRef: target.headRefName, baseRef: target.baseRefName }, focus);
    startHubThread({
      organizationId, ownerId: member.id, requestId, workspaceId,
      computerId: choice.selected,
      computerName: choice.computerName || "Computer unavailable",
      message,
      // A review is yours: its findings and rules are, so its thread starts private.
      visibility: "private",
      review: { repository, number: target.number },
      ...choice.executionChoice,
    });
    onStarted(requestId);
  };

  if (nothing) {
    const go = (deviceId: "computers" | "cloud") => navigateLocation({ route: { name: "settings", tab: "devices", organizationId, deviceId } });
    return (
      <>
        <div className="flex flex-col gap-[3px]">
          <PopoverTitle className="text-sm leading-5 font-semibold text-foreground">No computer can review this yet</PopoverTitle>
          <PopoverDescription className="text-xs leading-[17px]">
            None of your computers has {name}, and your cloud computers have no model access. Add either one to start a review.
          </PopoverDescription>
        </div>
        <div className="flex items-center justify-end gap-2.5 pt-0.5">
          <Button type="button" variant="outline" data-link className={OUTLINE} onClick={() => go("cloud")}>Add model access</Button>
          <Button type="button" data-link className={PRIMARY} onClick={() => go("computers")}>Connect a computer</Button>
        </div>
      </>
    );
  }

  const selectedComputer = computers.find((entry) => entry.computerId === choice.selected);
  const ComputerIcon = choice.usingCloud ? Cloud : Laptop;
  const online = selectedComputer && selectedComputer.availability !== "offline";
  return (
    <>
      <div className="flex flex-col gap-[3px]">
        <PopoverTitle className="text-sm leading-5 font-semibold text-foreground">Review this pull request</PopoverTitle>
        <PopoverDescription className="text-xs leading-[17px]">An agent reads the change and marks what to look at. Nothing reaches GitHub until you send it.</PopoverDescription>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex h-[30px] shrink-0 items-center gap-2.5">
          <span className="w-[72px] shrink-0 text-xs leading-4 text-foreground/70">Computer</span>
          <Menu>
            <MenuTrigger
              aria-label="Computer"
              disabled={!choice.preferenceLoaded}
              render={<button type="button" className={cn(FIELD, "disabled:opacity-100")} />}
            >
              <ComputerIcon className="size-[13px] text-foreground/70" />
              <span className={cn("min-w-0 flex-1 truncate", !choice.computerName && "shimmer")}>{choice.computerName || "Choosing a computer"}</span>
              {online && <span aria-label="Online" className="size-1.5 shrink-0 rounded-full bg-success-foreground" />}
              <ChevronDown className="size-3 text-muted-foreground" />
            </MenuTrigger>
            <MenuContent align="start" className="w-[var(--anchor-width)] min-w-56">
              <MenuGroup>
                {choice.cloudOptions.map((option) => (
                  <MenuItem key={option.id} onClick={() => choice.pick({ workspaceId, computerId: option.id })} className="text-xs">
                    <Cloud className="size-3.5" />{option.name}<MenuItemCheck checked={choice.selected === option.id} />
                  </MenuItem>
                ))}
                {choice.eligible.map((option) => (
                  <MenuItem key={option.computerId} onClick={() => choice.pick({ workspaceId, computerId: option.computerId })} className="text-xs">
                    <Laptop className="size-3.5" />{option.name}<MenuItemCheck checked={choice.selected === option.computerId} />
                  </MenuItem>
                ))}
              </MenuGroup>
              {choice.unavailable.length > 0 && (
                <MenuGroup>
                  <MenuGroupLabel className="px-2 pt-2 pb-1 text-[11px] font-normal text-muted-foreground">Can't review</MenuGroupLabel>
                  {choice.unavailable.map((option) => (
                    <MenuItem key={option.id} disabled className="flex-col items-start gap-0 text-xs">
                      <span className="flex items-center gap-2"><Cloud className="size-3.5" />{option.name}</span>
                      <span className="pl-[22px] text-[11px] text-muted-foreground">{option.reason}</span>
                    </MenuItem>
                  ))}
                </MenuGroup>
              )}
            </MenuContent>
          </Menu>
        </div>
        <div className="flex h-[30px] shrink-0 items-center gap-2.5">
          <span className="w-[72px] shrink-0 text-xs leading-4 text-foreground/70">Model</span>
          {choice.modelReady ? (
            <ModelPickerButton
              value={choice.selectedChoice}
              onPick={choice.setPickedModel}
              catalogue={choice.modelCatalogue}
              cataloguePending={choice.cataloguePending}
              className={cn(FIELD, "w-auto justify-start [&>svg:last-child]:size-3 [&>svg:last-child]:opacity-100 [&>svg:last-child]:text-muted-foreground")}
            />
          ) : (
            <span className={cn(FIELD, "text-muted-foreground")}><span className="shimmer">Choosing a model</span></span>
          )}
        </div>
      </div>
      <textarea
        aria-label="Anything to focus on"
        value={focus}
        maxLength={4000}
        placeholder="Anything to focus on? Optional"
        onChange={(change) => setFocus(change.target.value)}
        onKeyDown={(key) => { if (key.key === "Enter" && (key.metaKey || key.ctrlKey)) { key.preventDefault(); start(); } }}
        className="field-sizing-content h-16 max-h-48 min-h-16 w-full resize-none rounded-[10px] border border-foreground/10 bg-background/45 px-3 py-2.5 text-xs leading-[18px] text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-primary"
      />
      <div className="flex items-center gap-[7px]">
        <Book aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        <span className={cn("min-w-0 flex-1 text-xs leading-4 text-foreground/70", !rules && "shimmer")}>
          {rules ? rulesApplyLine(rules, repository, name) : "Reading your rules"}
        </span>
        <Button type="button" variant="ghost" size="xs" className="h-5 px-1 text-xs font-normal text-muted-foreground hover:text-foreground" onClick={onViewRules}>View</Button>
      </div>
      {choice.error && <p role="alert" className="text-xs leading-4 text-destructive">{choice.error}</p>}
      <div className="flex items-center justify-end gap-2.5 pt-0.5">
        <Button type="button" variant="outline" className={OUTLINE} onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={!member || !workspace || !choice.canStart} className={PRIMARY} onClick={start}>Start review</Button>
      </div>
    </>
  );
}
