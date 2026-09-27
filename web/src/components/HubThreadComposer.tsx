import { startHubThread } from "@/lib/hub-thread-start";
import { cloudShareAllowsProvider, computerModels, hostedComposerChoice, hostedExecutionChoice, hostedModels } from "@/lib/hub-models";
import { resolveModelDefault } from "@/lib/model-defaults";
import { useHubModelDefaults } from "./HubModelDefault";
import { BranchPicker } from "./BranchPicker";
import type { GitBranch } from "@/state/types";
import { toast } from "sonner";
import { ThreadComposerEditor } from "./ThreadComposerEditor";
import { NewThreadSurface, ComposerWorkspaceTrigger } from "./NewThreadSurface";
import { WorkspaceMark } from "./WorkspaceIcon";
import { ComposerMenu } from "./ComposerMenu";
import { Check, Cloud, Laptop, Lock, Users } from "lucide-react";
import { InputGroupButton, InputGroupText } from "./ui/input-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "./ui/dropdown-menu";
import { EmptyState } from "@/components/EmptyState";
import { ModelPickerButton } from "./ModelPicker";
import { type ModelChoice } from "@/lib/providers";
import type { ModelAccessResponse } from "./HubModelAccess";
import { CLOUD_COMPUTERS, CURSOR_CLOUD_COMPUTER_ID, cloudComputerProvider } from "@remy/contract";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ComputerSummary } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { PaneLoading } from "@/components/PaneLoading";
import { useHubResource } from "@/lib/hub-organization";
import { navigateLocation } from "@/lib/route";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { usePersonalHub } from "@/lib/hub-scope";
import { composerSnapshot, saveComposerSnapshot, type ComposerSnapshot } from "@/lib/hub-composer-cache";
import { cacheHubWorkspaces, cachedHubWorkspaces, hasCachedHubWorkspaces } from "@/lib/hub-workspace-cache";
export type HubThreadWorkspaceOption = {
  key: string;
  organizationId: string;
  id: string;
  name: string;
  origin: string;
  icon?: string;
  tint?: string;
  label: string;
  /// The account, shown muted only to tell apart workspaces with the same name.
  detail?: string;
};
export function HubThreadComposer({
  organizationId,
  memberId,
  computers,
  computersLoaded,
  computerError,
  canManageWorkspaces,
  open,
  sharingControl,
  controlledVisibility,
  controlledMessage,
  onMessageChange,
  workspaceOptions,
  controlledWorkspaceId,
  onWorkspaceChange,
}: {
  organizationId: string;
  memberId?: string;
  computers: ComputerSummary[];
  computersLoaded: boolean;
  computerError: string;
  canManageWorkspaces: boolean;
  open: (computer: string, thread: string) => void;
  sharingControl?: ReactNode;
  controlledVisibility?: "private" | "open";
  controlledMessage?: string;
  onMessageChange?: (message: string) => void;
  workspaceOptions?: HubThreadWorkspaceOption[];
  controlledWorkspaceId?: string;
  onWorkspaceChange?: (workspace: HubThreadWorkspaceOption) => void;
}) {
  const isPersonal = usePersonalHub();
  const catalogue = useHubResource<{
    workspaces: { id: string; name: string; origin: string; icon?: string; tint?: string }[];
  }>(organizationId, "/workspaces");
  // The list this device last saw paints the composer while the account's own
  // read is in flight; starting a thread still waits for the fresh one.
  const savedWorkspaces = useMemo(() => cachedHubWorkspaces(organizationId), [organizationId]);
  const workspaces = catalogue.value?.workspaces ?? (catalogue.error ? [] : savedWorkspaces);
  useEffect(() => {
    if (catalogue.value && !catalogue.stale) cacheHubWorkspaces(organizationId, catalogue.value.workspaces.map(w => ({ ...w, organizationId })));
  }, [catalogue.value, catalogue.stale, organizationId]);
  const catalogueKnown = !!catalogue.value || !!workspaceOptions || (!catalogue.error && hasCachedHubWorkspaces(organizationId));
  const go = (name: "workspaces" | "settings") => {
    navigateLocation({
      route:
        name === "settings"
          ? { name, tab: "devices", organizationId }
          : { name, organizationId },
    });
  };
  const [branch, setBranch] = useState("");
  const [resolvingBranch, setResolvingBranch] = useState(true);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const base = hubThreadBase(organizationId),
    [localWorkspaceId, setWorkspace] = useState(""),
    [picked, pick] = useState<{ workspaceId: string; computerId: string }>(),
    [preference, setPreference] = useState<{ workspaceId: string; computerId: string | null }>(),
    [fallback, setFallback] = useState<{ workspaceId: string; computerId?: string; hostedProvider?: string }>(),
    [visibilityOverride, setVisibilityOverride] = useState<"private" | "open">(),
    [draftMessage, setDraftMessage] = useState(""),
    [error, setError] = useState("");
  const message = controlledMessage ?? draftMessage;
  const setMessage = onMessageChange ?? setDraftMessage;
  const workspaceId = controlledWorkspaceId ?? localWorkspaceId;
  useEffect(() => {
    if (controlledWorkspaceId === undefined && (catalogue.value || workspaces.length))
      setWorkspace((id) =>
        workspaces.some((w) => w.id === id)
          ? id
          : (workspaces[0]?.id ?? ""),
      );
  }, [catalogue.value, workspaces, controlledWorkspaceId]);
  useEffect(() => {
    setBranch("");
    setRequestId(crypto.randomUUID());
    setVisibilityOverride(undefined);
    setError("");
    setResolvingBranch(true);
  }, [workspaceId, organizationId]);
  // What this device last settled on for the workspace. It paints the toolbar
  // while the reads below are in flight, and it lets them start with the
  // computer they will most likely end on. It never decides anything.
  const snapshot = useMemo(() => composerSnapshot(organizationId, workspaceId), [organizationId, workspaceId]);
  // The saved preference is a cheap read that needs only the workspace, so it
  // starts at once rather than after the computers and cloud settings it is
  // later checked against.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void hubRequest<{ computerId: string | null }>(`${base}/computers/preference?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(value => { if (!cancelled) setPreference({ workspaceId, computerId: value.computerId }); })
      .catch(() => { if (!cancelled) setPreference({ workspaceId, computerId: null }); });
    return () => { cancelled = true; };
  }, [base, workspaceId]);
  const modelAccess = useHubResource<ModelAccessResponse>(organizationId,"/model-access");
  const cloudConnections = useHubResource<{settings?:{provider?:string};enabledProviders?: string[];cloudStart?: Record<string, {owner:boolean;providers:{id:string;allowed:boolean}[]}>}>(organizationId, "/hosted");
  const cloudOptions = useMemo(() => CLOUD_COMPUTERS.filter(c => cloudConnections.value?.enabledProviders?.includes(c.provider)), [cloudConnections.value?.enabledProviders]);
  const workspaceChoices: HubThreadWorkspaceOption[] = workspaceOptions ?? workspaces.map((item) => ({
    ...item,
    key: item.id,
    organizationId,
    label: item.name,
  }));
  const workspace = workspaceChoices.find((item) => item.organizationId === organizationId && item.id === workspaceId);
  const eligible = useMemo(() => computers.filter(
    (c) =>
      c.ownership !== "hosted" &&
      c.canUse &&
      c.availability !== "offline" &&
      !c.updateRequired &&
      (c.ownerUserId === memberId || (c.capabilities.providers?.length ?? 0) > 0) &&
      c.capabilities.workspaces.some(
        (w) => w.id === workspaceId || w.origin === workspace?.origin,
      ),
  ), [computers, memberId, workspace?.origin, workspaceId]);
  const optionsKnown = computersLoaded && !!cloudConnections.value;
  const options = useMemo(() => [...cloudOptions.map(c => c.id), ...eligible.map(c => c.computerId)], [cloudOptions, eligible]);
  const saved = preference?.workspaceId === workspaceId ? preference : undefined;
  const savedValid = !!saved?.computerId && options.includes(saved.computerId);
  // Only when there is no usable preference does the hub have to choose, which
  // lists every computer and is the slowest read here.
  const needsFallback = !!workspaceId && !!saved && optionsKnown && !savedValid;
  useEffect(() => {
    if (!needsFallback) return;
    let cancelled = false;
    void hubRequest<{ computerId?: string; hostedProvider?: string }>(`${base}/computers/choice`, "POST", { workspaceId, trigger: "manual" })
      .then(value => { if (!cancelled) setFallback({ workspaceId, ...value }); })
      .catch(e => {
        if (cancelled) return;
        setFallback({ workspaceId });
        setError(e instanceof Error ? e.message : "Your default computer could not be loaded.");
      });
    return () => { cancelled = true; };
  }, [base, needsFallback, workspaceId]);
  const chosen = (() => {
    if (!optionsKnown || !saved) return "";
    if (savedValid) return saved.computerId!;
    const resolved = fallback?.workspaceId === workspaceId ? fallback : undefined;
    if (!resolved) return "";
    let next = resolved.computerId && options.includes(resolved.computerId) ? resolved.computerId : "";
    if (!next && resolved.hostedProvider) next = cloudOptions.find(c => c.provider === resolved.hostedProvider)?.id ?? "";
    if (!next && cloudConnections.value?.settings?.provider) next = cloudOptions.find(c => c.provider === cloudConnections.value?.settings?.provider)?.id ?? "";
    return next || eligible[0]?.computerId || cloudOptions[0]?.id || "";
  })();
  const userPick = picked?.workspaceId === workspaceId && (!optionsKnown || options.includes(picked.computerId)) ? picked.computerId : undefined;
  /// The computer the thread starts on: yours, or the one the reads settled on.
  const selected = userPick ?? chosen;
  const unresolved = !!workspaceId && optionsKnown && !!saved && !savedValid && fallback?.workspaceId === workspaceId && !chosen;
  useEffect(() => {
    if (unresolved) setError("No computer is available for this workspace.");
  }, [unresolved]);
  const preferenceLoaded = !!selected || unresolved;
  // Reads keyed on the computer start with the one they will most likely end
  // on, so the model default and branch do not wait for the choice to settle.
  const likelyComputer = selected || saved?.computerId || (saved ? "" : snapshot?.computerId) || "";
  const defaults = useHubModelDefaults(organizationId, workspaceId || undefined, likelyComputer || undefined);
  const [pickedModel,setPickedModel]=useState<{workspaceId:string;choice:ModelChoice}>();
  const latchedDefaults = useRef(defaults.value);
  if (defaults.value) latchedDefaults.current = defaults.value;
  useEffect(() => { latchedDefaults.current = undefined; }, [workspaceId, organizationId]);
  const resolvedDefaults = defaults.value ?? latchedDefaults.current;
  const inheritedModel = resolveModelDefault(resolvedDefaults?.workspace, resolvedDefaults?.computer, {provider:"",model:""});
  const usingCloud=!!cloudComputerProvider(selected);
  const usingCursorCloud=cloudComputerProvider(selected)==="cursor-cloud";
  const cloudStart = usingCloud ? cloudConnections.value?.cloudStart?.[cloudComputerProvider(selected) ?? ""] : undefined;
  const allowedCloudRuntimes = cloudStart && !cloudStart.owner ? new Set(cloudStart.providers.filter(provider => provider.allowed).map(provider => provider.id)) : undefined;
  const resolvedChoice = hostedComposerChoice(modelAccess.value?.providers ?? [], inheritedModel);
  const modelChoice = pickedModel?.workspaceId === workspaceId ? pickedModel.choice : resolvedChoice;
  const cloudModels = hostedModels(modelAccess.value?.providers ?? [], modelChoice).filter(provider => cloudShareAllowsProvider(allowedCloudRuntimes, provider.id));
  const localModels = computerModels(computers.find(c=>c.computerId===selected)?.capabilities.providers ?? []);
  const modelCatalogue = usingCursorCloud ? [] : usingCloud || !selected ? cloudModels : localModels;
  const cataloguePending = usingCloud && !modelAccess.value && !modelAccess.error;
  const selectedChoice = modelCatalogue.some(p=>p.id===modelChoice.provider && p.models.some(m=>m.value===modelChoice.model))
    ? modelChoice
    : {provider:modelCatalogue[0]?.id ?? modelChoice.provider, model:modelCatalogue[0]?.models[0]?.value ?? modelChoice.model};
  const chosenProvider=modelCatalogue.find(p=>p.id===selectedChoice.provider);
  const choiceValid=chosenProvider?.models.some(m=>m.value===selectedChoice.model);
  const executionChoice=choiceValid ? hostedExecutionChoice(selectedChoice) : {};
  // Whether the computer is shared is on the computer itself, which is what the
  // hub's recommendation read; asking it again cost a slow round trip.
  const recommendedVisibility: "private" | "open" | undefined = isPersonal
    ? "private"
    : !selected
      ? undefined
      : cloudComputerProvider(selected)
        ? "private"
        : computers.find(c => c.computerId === selected)?.shared ? "open" : "private";
  const visibility = controlledVisibility ?? visibilityOverride ?? recommendedVisibility ?? "private";
  const visibilityLoaded = controlledVisibility !== undefined || isPersonal || recommendedVisibility !== undefined;
  const branchComputer = selected || likelyComputer;
  const branchFromCloud = !!cloudComputerProvider(branchComputer);
  const liveLocal = computers.find(c => c.computerId === branchComputer)?.capabilities.workspaces.find(w => w.id === workspaceId || w.origin === workspace?.origin)?.id;
  // Until the computer list answers, its copy of the workspace is the one this
  // device last read branches from. A miss is only a guess going wrong, so it
  // stays quiet and the real copy reads again once the list lands.
  const guessedLocal = !branchFromCloud && !computersLoaded && snapshot?.computerId === branchComputer ? snapshot.localWorkspaceId : undefined;
  const branchLocal = branchFromCloud ? undefined : liveLocal ?? guessedLocal;
  const branchGuess = !branchFromCloud && !liveLocal && !!guessedLocal;
  const loadBranches = useCallback(async (id: string) => {
    if (!branchFromCloud) {
      if (!branchLocal) throw Error("Choose another computer to load branches.");
      return (await hubRequest<{ branches: GitBranch[] }>(`${base}/computers/${encodeURIComponent(branchComputer)}/workspaces/${encodeURIComponent(branchLocal)}/branches`)).branches;
    }
    const response = await hubRequest<{ branches: GitBranch[] }>(`${base}/github/workspace-branches?workspace=${encodeURIComponent(id)}`);
    return response.branches;
  }, [base, branchFromCloud, branchComputer, branchLocal]);
  const branchRef = useRef(branch);
  branchRef.current = branch;
  const guessRef = useRef(branchGuess);
  guessRef.current = branchGuess;
  const [guessMissed, setGuessMissed] = useState(false);
  const [branchAttempt, setBranchAttempt] = useState(0);
  useEffect(() => {
    if (!branchGuess && guessMissed) { setGuessMissed(false); setBranchAttempt(n => n + 1); }
  }, [branchGuess, guessMissed]);
  // A cloud computer's branches come from GitHub and need only the workspace;
  // a computer's own need its copy of it. Neither waits for the choice.
  const branchReady = !!workspaceId && !!branchComputer && (branchFromCloud || !!branchLocal);
  useEffect(() => {
    if (!branchReady) return;
    let cancelled = false;
    const keepText = !!branchRef.current;
    if (!keepText) setResolvingBranch(true);
    void loadBranches(workspaceId).then(branches => {
      if (cancelled) return;
      setBranch(value => {
        if (value && branches.some(entry => entry.name === value)) return value;
        return branches.find(entry => entry.current)?.name || value || "";
      });
      setResolvingBranch(false);
    }).catch(() => {
      if (cancelled) return;
      if (guessRef.current) { setGuessMissed(true); return; }
      if (!keepText) toast.error("Couldn't load your branch. Open the branch picker to retry.");
      setResolvingBranch(false);
    });
    return () => { cancelled = true; };
  }, [workspaceId, branchReady, loadBranches, branchAttempt]);
  useEffect(() => {
    if (preferenceLoaded && !branchReady) setResolvingBranch(false);
  }, [preferenceLoaded, branchReady]);
  const modelAccessReady = !!modelAccess.value || !!modelAccess.error;
  const defaultsReady = defaults.value !== undefined || !!defaults.error;
  const computerName = cloudOptions.find(c => c.id === selected)?.name ?? eligible.find(c => c.computerId === selected)?.name ?? (preferenceLoaded ? "Computer unavailable" : "");
  // Each control shows as soon as its own reads answer, rather than the whole
  // toolbar waiting for the slowest of them.
  const computerReady = preferenceLoaded;
  // Once shown for a workspace, the model stays while a new computer's default
  // is read, rather than blinking out.
  const modelShown = useRef("");
  const modelKey = `${organizationId}:${workspaceId}`;
  const modelReady = !!selected && modelAccessReady && (defaultsReady || modelShown.current === modelKey);
  if (modelReady) modelShown.current = modelKey;
  const branchShown = !resolvingBranch || !!branch;
  /// The last settled toolbar, drawn in place of controls whose reads have not
  /// answered. Nothing in it can be opened or sent.
  const early = error ? undefined : snapshot;
  const toolbarReady = computerReady && modelReady && branchShown && visibilityLoaded;
  // Kept as a string so the save runs when what it says changes, not on every
  // render that rebuilds the catalogue objects.
  const snapshotBody = toolbarReady && selected && workspaceId ? JSON.stringify({
    computerId: selected,
    computerName: computerName || "Computer unavailable",
    cloud: usingCloud,
    ...(!usingCloud && liveLocal && branchComputer === selected ? { localWorkspaceId: liveLocal } : {}),
    visibility,
    ...(branch ? { branch } : {}),
    ...(chosenProvider && !usingCursorCloud ? { model: { choice: selectedChoice, provider: { ...chosenProvider, models: chosenProvider.models.filter(m => m.value === selectedChoice.model) } } } : {}),
  } satisfies ComposerSnapshot) : "";
  useEffect(() => {
    if (snapshotBody) saveComposerSnapshot(organizationId, workspaceId, JSON.parse(snapshotBody) as ComposerSnapshot);
  }, [snapshotBody, organizationId, workspaceId]);
  if (!catalogueKnown || (!workspaceChoices.length && !catalogue.value && !catalogue.error && !workspaceOptions))
    return catalogue.error ? (
      <p role="alert">{catalogue.error}</p>
    ) : (
      <PaneLoading label="Loading workspaces" />
    );
  if (!workspaceChoices.length)
    return <HubThreadSetup organizationId={organizationId} computers={computers} computersLoaded={computersLoaded} computerError={computerError} canManageWorkspaces={canManageWorkspaces} go={go} />;
  return (
    <NewThreadSurface heading={<>
      <DropdownMenu>
        <ComposerWorkspaceTrigger disabled={false} aria-label="Thread workspace">
          {workspace && <WorkspaceMark home={false} workspace={workspace} size="lg" organizationId={workspace.organizationId} />}
          {workspace?.name ?? "a workspace"}
        </ComposerWorkspaceTrigger>
        <DropdownMenuContent>
          {workspaceChoices.map(w => <DropdownMenuItem key={w.key} onSelect={() => { if (onWorkspaceChange) onWorkspaceChange(w); else setWorkspace(w.id); pick(undefined); }}>
            <WorkspaceMark home={false} workspace={w} size="sm" organizationId={w.organizationId} />{w.label}{w.detail && <span className="text-muted-foreground">{w.detail}</span>}{w.organizationId === organizationId && w.id === workspaceId && <Check className="ml-auto" />}
          </DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </>}>
    <form
      className="flex flex-col gap-3"
      aria-label="New thread"
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          !workspace ||
          !memberId ||
          !selected ||
          !preferenceLoaded ||
          !visibilityLoaded ||
          !resolvedDefaults ||
          !message.trim() ||
          !catalogue.value ||
          catalogue.stale ||
          (usingCloud && !usingCursorCloud && !modelAccess.value) ||
          (!usingCursorCloud && (usingCloud || !!selectedChoice.provider) && !choiceValid)
        )
          return;
        startHubThread({
          organizationId, ownerId: memberId, requestId, workspaceId,
          computerId: selected,
          computerName: cloudOptions.find(c => c.id === selected)?.name ?? eligible.find(c => c.computerId === selected)?.name ?? "Computer unavailable",
          message: message.trim(), visibility, ...(branch ? {branch} : {}), ...(usingCursorCloud ? {provider: "cursor"} : executionChoice),
        });
        open("pending", requestId);
      }}
    >
      <ThreadComposerEditor
        textarea={{ id: "hub-thread-message", maxLength: 64000, value: message, onChange: e => setMessage(e.target.value), required: true, disabled: false }}
        canSend={!!memberId && !!workspace && !!selected && preferenceLoaded && visibilityLoaded && !!resolvedDefaults && !!message.trim() && !!catalogue.value && !catalogue.stale && !(usingCloud && !usingCursorCloud && !modelAccess.value) && (usingCursorCloud || !(usingCloud || selectedChoice.provider) || !!choiceValid)}
        busy={false} sendLabel="Send"
        controls={modelReady
          ? (usingCursorCloud
            ? <InputGroupText>Cursor Cloud default</InputGroupText>
            : <ModelPickerButton variant="composer" value={selectedChoice} onPick={choice=>setPickedModel({workspaceId,choice})} catalogue={modelCatalogue} cataloguePending={cataloguePending} disabled={false} />)
          : early?.model
            ? <ModelPickerButton variant="composer" value={early.model.choice} onPick={() => undefined} catalogue={[early.model.provider]} pending />
            : early?.cloud && early.computerId === CURSOR_CLOUD_COMPUTER_ID
              ? <InputGroupText>Cursor Cloud default</InputGroupText>
              : <span className="inline-flex h-6 min-w-40" aria-hidden />}
        contextEnd={branchShown && computerReady
          ? <BranchPicker workspaceId={workspaceId} branch={branch || "Choose branch"} pending={false} busy={false} loadBranches={loadBranches} onPick={async value => { setBranch(value); return true; }} />
          : early?.branch
            ? <BranchPicker workspaceId={workspaceId} branch={early.branch} pending busy onPick={async () => false} />
            : <span className="inline-flex h-6 min-w-24" aria-hidden />}
        context={computerReady ? <>
          <ComposerMenu ariaLabel="Thread computer" icon={usingCloud ? Cloud : Laptop}
            label={computerName || "Computer unavailable"}
            value={selected} disabled={false} pending={false}
            options={[...cloudOptions.map(c => ({ value: c.id, label: c.name, icon: Cloud })), ...eligible.map(c => ({ value: c.computerId, label: c.name, icon: Laptop }))]}
            onChange={async v => {
              const previous = picked;
              pick({ workspaceId, computerId: v }); setError("");
              try { await hubRequest(`${base}/computers/preference`, "POST", { workspaceId, computerId: v }); }
              catch { pick(previous); toast.error("Your computer choice could not be saved. Try again."); }
            }} />
          {sharingControl ?? (!isPersonal && (visibilityLoaded
            ? <ComposerMenu ariaLabel="Thread sharing" icon={visibility === "open" ? Users : Lock}
              label={visibility === "open" ? "Shared" : "Private"} value={visibility} pending={false}
              options={[{ value: "open", label: "Shared", icon: Users }, { value: "private", label: "Private", icon: Lock }]}
              onChange={value => setVisibilityOverride(value as "private" | "open")} />
            : <SharingPlaceholder visibility={early?.visibility} />))}
          {cloudConnections.value && computersLoaded && !cloudOptions.length && !eligible.length && <InputGroupButton data-link onClick={() => go("settings")}>Set up a computer</InputGroupButton>}
        </> : early ? <>
          <ComposerMenu ariaLabel="Thread computer" icon={early.cloud ? Cloud : Laptop} label={early.computerName} value={early.computerId} pending
            options={[{ value: early.computerId, label: early.computerName }]} onChange={() => undefined} />
          {sharingControl ?? (!isPersonal && <SharingPlaceholder visibility={early.visibility} />)}
        </> : <span className="inline-flex h-6 min-w-40" aria-hidden />}
      />
      {defaults.error && <p role="alert">{defaults.error}</p>}
      {cloudConnections.error && <p role="alert">{cloudConnections.error}</p>}
      {catalogue.stale && (
        <p role="status">
          Reconnect to refresh your workspaces before starting a thread.
        </p>
      )}
      {error && <p role="alert">{error}</p>}

    </form>
    </NewThreadSurface>
  );
}

function SharingPlaceholder({ visibility }: { visibility?: "private" | "open" }) {
  if (!visibility) return <span className="inline-flex h-6 min-w-20" aria-hidden />;
  return <ComposerMenu ariaLabel="Thread sharing" icon={visibility === "open" ? Users : Lock} label={visibility === "open" ? "Shared" : "Private"} value={visibility} pending
    options={[{ value: visibility, label: visibility === "open" ? "Shared" : "Private" }]} onChange={() => undefined} />;
}

function HubThreadSetup({ organizationId, computers, computersLoaded, computerError, canManageWorkspaces, go }: {
  organizationId: string;
  computers: ComputerSummary[];
  computersLoaded: boolean;
  computerError: string;
  canManageWorkspaces: boolean;
  go: (name: "workspaces" | "settings") => void;
}) {
  const cloud = useHubResource<{ available: boolean; settings: { enabled: boolean }; enabledProviders?: string[] }>(organizationId, "/hosted");
  const readyComputer = computers.some(c => c.canUse && c.availability !== "offline" && !c.updateRequired);
  if (computerError || (!readyComputer && cloud.error))
    return <p role="alert">{computerError || cloud.error}</p>;
  if (!computersLoaded || (!readyComputer && !cloud.value))
    return <PaneLoading label="Checking your computers" />;
  const needsComputer = !readyComputer && !(cloud.value?.available && (cloud.value.enabledProviders?.length ?? 0) > 0);
  if (needsComputer)
    return (
      <EmptyState title={computers.length ? "Your computer is unavailable" : "Set up your first computer"} description={computers.length
              ? "Check your computer’s connection and access before starting a thread."
              : "Connect your Mac or configure cloud execution to run your threads."}>
        <Button data-link onClick={() => go("settings")}>
          {computers.length ? "View computers" : "Set up a computer"}
        </Button>
      </EmptyState>
    );
  return (
    <EmptyState title={canManageWorkspaces ? "Add your first workspace" : "No workspaces available"} description={canManageWorkspaces
            ? "Choose a repository for your first thread."
            : "Ask an organization administrator to add a workspace or give you access."}>
      {canManageWorkspaces && <Button data-link onClick={() => go("workspaces")}>Add a workspace</Button>}
    </EmptyState>
  );
}
