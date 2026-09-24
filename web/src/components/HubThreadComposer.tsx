import { startHubThread } from "@/lib/hub-thread-start";
import { cloudShareAllowsProvider, hostedComposerChoice, hostedExecutionChoice, hostedModels } from "@/lib/hub-models";
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
import { PROVIDERS, type ModelChoice } from "@/lib/providers";
import type { ModelAccessEntry } from "./HubModelAccess";
import { CLOUD_COMPUTERS, cloudComputerProvider } from "@remy/contract";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ComputerSummary } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { PaneLoading } from "@/components/PaneLoading";
import { useHubResource } from "@/lib/hub-organization";
import { navigateLocation } from "@/lib/route";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { usePersonalHub } from "@/lib/hub-scope";
export type HubThreadWorkspaceOption = {
  key: string;
  organizationId: string;
  id: string;
  name: string;
  origin: string;
  icon?: string;
  tint?: string;
  label: string;
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
  const workspaces = catalogue.value?.workspaces ?? [];
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
    [selected, select] = useState(""),
    [preferenceLoaded, setPreferenceLoaded] = useState(false),
    [recommendedVisibility, setRecommendedVisibility] = useState<"private" | "open">(),
    [visibilityOverride, setVisibilityOverride] = useState<"private" | "open">(),
    [draftMessage, setDraftMessage] = useState(""),
    [error, setError] = useState("");
  const message = controlledMessage ?? draftMessage;
  const setMessage = onMessageChange ?? setDraftMessage;
  const workspaceId = controlledWorkspaceId ?? localWorkspaceId;
  useEffect(() => {
    if (catalogue.value && controlledWorkspaceId === undefined)
      setWorkspace((id) =>
        catalogue.value!.workspaces.some((w) => w.id === id)
          ? id
          : (catalogue.value!.workspaces[0]?.id ?? ""),
      );
  }, [catalogue.value, controlledWorkspaceId]);
  useEffect(() => {
    setBranch("");
    setRequestId(crypto.randomUUID());
    setVisibilityOverride(undefined);
    setError("");
    select("");
    setPreferenceLoaded(false);
    setResolvingBranch(true);
  }, [workspaceId, organizationId]);
  useEffect(() => {
    let cancelled = false;
    setRecommendedVisibility(isPersonal ? "private" : undefined);
    if (!workspaceId || !selected || !preferenceLoaded || isPersonal) return;
    void hubRequest<{ recommendedVisibility: "private" | "open" }>(`${base}/routing/resolve`, "POST", {
      workspaceId,
      trigger: "manual",
      computerId: selected,
    }).then(value => {
      if (!cancelled) setRecommendedVisibility(value.recommendedVisibility);
    }).catch(e => {
      if (!cancelled) setError(e.message);
    });
    return () => { cancelled = true; };
  }, [base, isPersonal, preferenceLoaded, selected, workspaceId]);
  const codexAccount=useHubResource<{phase:string}>(organizationId,workspaceId ? `/hosted/${encodeURIComponent(workspaceId)}/codex` : null);
  const modelAccess = useHubResource<{providers:ModelAccessEntry[]}>(organizationId,"/model-access");
  const defaults = useHubModelDefaults(organizationId, workspaceId || undefined, selected || undefined);
  const [pickedModel,setPickedModel]=useState<{workspaceId:string;choice:ModelChoice}>();
  const latchedDefaults = useRef(defaults.value);
  if (defaults.value) latchedDefaults.current = defaults.value;
  useEffect(() => { latchedDefaults.current = undefined; }, [workspaceId, organizationId]);
  const resolvedDefaults = defaults.value ?? latchedDefaults.current;
  const inheritedModel = resolveModelDefault(resolvedDefaults?.workspace, resolvedDefaults?.remy, {provider:"",model:""}, resolvedDefaults?.computer);
  const usingCloud=!!cloudComputerProvider(selected);
  const usingCursorCloud=cloudComputerProvider(selected)==="cursor-cloud";
  const chatgpt = codexAccount.value?.phase === "connected";
  const cloudConnections = useHubResource<{settings?:{provider?:string};enabledProviders?: string[];cloudStart?: Record<string, {owner:boolean;providers:{id:string;allowed:boolean}[]}>}>(organizationId, "/hosted");
  const cloudStart = usingCloud ? cloudConnections.value?.cloudStart?.[cloudComputerProvider(selected) ?? ""] : undefined;
  const allowedCloudRuntimes = cloudStart && !cloudStart.owner ? new Set(cloudStart.providers.filter(provider => provider.allowed).map(provider => provider.id)) : undefined;
  const resolvedChoice = hostedComposerChoice(modelAccess.value?.providers ?? [], chatgpt, inheritedModel);
  const modelChoice = pickedModel?.workspaceId === workspaceId ? pickedModel.choice : resolvedChoice;
  const cloudModels = hostedModels(modelAccess.value?.providers ?? [], chatgpt, modelChoice).filter(provider => cloudShareAllowsProvider(allowedCloudRuntimes, provider.id));
  const localModels = (computers.find(c=>c.computerId===selected)?.capabilities.providers ?? []).flatMap(p=>{
    const runtime=PROVIDERS.find(v=>v.id===p.id);
    return runtime ? [{...runtime,models:p.models.map(value=>({value,label:value || "Default"}))}] : [];
  });
  const modelCatalogue = usingCursorCloud ? [] : usingCloud || !selected ? cloudModels : localModels;
  const cataloguePending = usingCloud && !modelAccess.value && !modelAccess.error;
  const selectedChoice = modelCatalogue.some(p=>p.id===modelChoice.provider && p.models.some(m=>m.value===modelChoice.model))
    ? modelChoice
    : {provider:modelCatalogue[0]?.id ?? modelChoice.provider, model:modelCatalogue[0]?.models[0]?.value ?? modelChoice.model};
  const chosenProvider=modelCatalogue.find(p=>p.id===selectedChoice.provider);
  const choiceValid=chosenProvider?.models.some(m=>m.value===selectedChoice.model);
  const executionChoice=choiceValid ? hostedExecutionChoice(selectedChoice) : {};
  const cloudOptions = useMemo(() => CLOUD_COMPUTERS.filter(c => cloudConnections.value?.enabledProviders?.includes(c.provider)), [cloudConnections.value?.enabledProviders]);
  const workspaceChoices = workspaceOptions ?? workspaces.map((item) => ({
    ...item,
    key: item.id,
    organizationId,
    label: item.name,
  }));
  const workspace = workspaceChoices.find((item) => item.organizationId === organizationId && item.id === workspaceId);
  const visibility = controlledVisibility ?? visibilityOverride ?? recommendedVisibility ?? "private";
  const visibilityLoaded = controlledVisibility !== undefined || isPersonal || recommendedVisibility !== undefined;
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
  useEffect(() => {
    let cancelled = false;
    if (!workspaceId || !computersLoaded || !cloudConnections.value) return () => { cancelled = true; };
    void (async () => {
      try {
        const preference = await hubRequest<{ computerId: string | null }>(
          `${base}/routing/preference?workspaceId=${encodeURIComponent(workspaceId)}`,
        );
        const options = [...cloudOptions.map(c => c.id), ...eligible.map(c => c.computerId)];
        let next = preference.computerId && options.includes(preference.computerId) ? preference.computerId : "";
        if (!next) {
          const resolved = await hubRequest<{ computerId?: string; hostedProvider?: string }>(`${base}/routing/resolve`, "POST", {
            workspaceId,
            trigger: "manual",
          });
          if (resolved.computerId && options.includes(resolved.computerId)) next = resolved.computerId;
          if (!next && resolved.hostedProvider) next = cloudOptions.find(c => c.provider === resolved.hostedProvider)?.id ?? "";
          if (!next && cloudConnections.value?.settings?.provider) next = cloudOptions.find(c => c.provider === cloudConnections.value?.settings?.provider)?.id ?? "";
          next ||= eligible[0]?.computerId ?? cloudOptions[0]?.id ?? "";
        }
        if (!next) throw Error("No computer is available for this workspace.");
        if (!cancelled) select((current) => current && options.includes(current) ? current : next);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Your default computer could not be loaded.");
      } finally {
        if (!cancelled) setPreferenceLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [base, cloudConnections.value, cloudOptions, computersLoaded, eligible, workspaceId]);
  const loadBranches = useCallback(async (id: string) => {
    if (!usingCloud) {
      const computer = computers.find(c => c.computerId === selected);
      const local = computer?.capabilities.workspaces.find(w => w.id === id || w.origin === workspace?.origin);
      if (!local) throw Error("Choose another computer to load branches.");
      return (await hubRequest<{ branches: GitBranch[] }>(`${base}/computers/${encodeURIComponent(selected)}/workspaces/${encodeURIComponent(local.id)}/branches`)).branches;
    }
    const response = await hubRequest<{ branches: GitBranch[] }>(`${base}/github/workspace-branches?workspace=${encodeURIComponent(id)}`);
    return response.branches;
  }, [base, usingCloud, selected, computers, workspace?.origin]);
  const branchRef = useRef(branch);
  branchRef.current = branch;
  useEffect(() => {
    if (!workspaceId || !selected || !preferenceLoaded) return;
    let cancelled = false;
    const keepText = !!branchRef.current;
    if (!keepText) setResolvingBranch(true);
    void loadBranches(workspaceId).then(branches => {
      if (cancelled) return;
      setBranch(value => {
        if (value && branches.some(entry => entry.name === value)) return value;
        return branches.find(entry => entry.current)?.name || value || "";
      });
    }).catch(() => {
      if (!cancelled && !keepText) toast.error("Couldn't load your branch. Open the branch picker to retry.");
    }).finally(() => {
      if (!cancelled) setResolvingBranch(false);
    });
    return () => { cancelled = true; };
  }, [workspaceId, preferenceLoaded, loadBranches]);
  const modelAccessReady = !!modelAccess.value || !!modelAccess.error;
  const defaultsReady = resolvedDefaults !== undefined || !!defaults.error;
  const toolbarReady = !!selected && defaultsReady && modelAccessReady && (!resolvingBranch || !!branch) && visibilityLoaded;
  const computerName = cloudOptions.find(c => c.id === selected)?.name ?? eligible.find(c => c.computerId === selected)?.name ?? (preferenceLoaded ? "Computer unavailable" : "");
  if (!catalogue.value)
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
          {workspaceChoices.map(w => <DropdownMenuItem key={w.key} onSelect={() => { if (onWorkspaceChange) onWorkspaceChange(w); else setWorkspace(w.id); select(""); }}>
            <WorkspaceMark home={false} workspace={w} size="sm" organizationId={w.organizationId} />{w.label}{w.organizationId === organizationId && w.id === workspaceId && <Check className="ml-auto" />}
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
        canSend={!!memberId && !!workspace && !!selected && preferenceLoaded && visibilityLoaded && !!resolvedDefaults && !!message.trim() && !catalogue.stale && !(usingCloud && !usingCursorCloud && !modelAccess.value) && (usingCursorCloud || !(usingCloud || selectedChoice.provider) || !!choiceValid)}
        busy={false} sendLabel="Send"
        controls={toolbarReady
          ? (usingCursorCloud
            ? <InputGroupText>Cursor Cloud default</InputGroupText>
            : <ModelPickerButton variant="composer" value={selectedChoice} onPick={choice=>setPickedModel({workspaceId,choice})} catalogue={modelCatalogue} cataloguePending={cataloguePending} disabled={false} />)
          : <span className="inline-flex h-6 min-w-40" aria-hidden />}
        contextEnd={toolbarReady
          ? <BranchPicker workspaceId={workspaceId} branch={branch || "Choose branch"} pending={false} busy={false} loadBranches={loadBranches} onPick={async value => { setBranch(value); return true; }} />
          : <span className="inline-flex h-6 min-w-24" aria-hidden />}
        context={toolbarReady ? <>
          <ComposerMenu ariaLabel="Thread computer" icon={usingCloud ? Cloud : Laptop}
            label={computerName || "Computer unavailable"}
            value={selected} disabled={false} pending={false}
            options={[...cloudOptions.map(c => ({ value: c.id, label: c.name, icon: Cloud })), ...eligible.map(c => ({ value: c.computerId, label: c.name, icon: Laptop }))]}
            onChange={async v => {
              const previous = selected;
              select(v); setError("");
              try { await hubRequest(`${base}/routing/preference`, "POST", { workspaceId, computerId: v }); }
              catch { select(previous); toast.error("Your computer choice could not be saved. Try again."); }
            }} />
          {sharingControl ?? (!isPersonal && <ComposerMenu ariaLabel="Thread sharing" icon={visibility === "open" ? Users : Lock}
            label={visibility === "open" ? "Shared" : "Private"} value={visibility} pending={false}
            options={[{ value: "open", label: "Shared", icon: Users }, { value: "private", label: "Private", icon: Lock }]}
            onChange={value => setVisibilityOverride(value as "private" | "open")} />)}
          {cloudConnections.value && computersLoaded && !cloudOptions.length && !eligible.length && <InputGroupButton data-link onClick={() => go("settings")}>Set up a computer</InputGroupButton>}
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
