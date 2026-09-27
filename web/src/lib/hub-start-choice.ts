import { useEffect, useMemo, useRef, useState } from "react";
import { CLOUD_COMPUTERS, cloudComputerProvider, type ComputerSummary } from "@remy/contract";
import { useHubModelDefaults } from "@/components/HubModelDefault";
import type { ModelAccessResponse } from "@/components/HubModelAccess";
import { cloudShareAllowsProvider, computerModels, executionToChoice, hostedComposerChoice, hostedExecutionChoice, hostedModels } from "./hub-models";
import { useHubResource } from "./hub-organization";
import { hubRequest, hubThreadBase } from "./hub-threads";
import { composerSnapshot } from "./hub-composer-cache";
import { resolveModelDefault } from "./model-defaults";
import type { ModelChoice } from "./providers";

/// A computer and model to start on that the caller already knows, such as
/// the last review in a workspace. Its provider and model are the pair a
/// start sends (`hostedExecutionChoice`), not the picker's.
export interface StartPreference {
  computerId: string;
  provider?: string | null;
  model?: string | null;
}

/// Which computer and model a new thread in a workspace starts on, and what
/// else could run it: the thread composer's decision, shared by everything
/// that starts a thread there (a review too), so they offer the same
/// computers, the same models and the same defaults.
///
/// The computer is what you picked, else `preferred` when it can still run,
/// else your saved choice for the workspace, else the hub's (`chooseComputer`).
/// The model is what you picked, else `preferred`'s on that computer, else
/// the workspace and computer defaults, checked against what the computer (or
/// cloud model access) can run. `exclude` takes cloud computers out with the
/// reason, for a start they cannot serve.
export function useHubStartChoice({
  organizationId,
  memberId,
  computers,
  computersLoaded,
  workspaceId,
  workspaceOrigin,
  preferred,
  exclude,
}: {
  organizationId: string;
  memberId?: string;
  computers: ComputerSummary[];
  computersLoaded: boolean;
  workspaceId: string;
  workspaceOrigin?: string;
  /// `"loading"` holds the computer back until it is known.
  preferred?: StartPreference | null | "loading";
  exclude?: (computerId: string) => string | undefined;
}) {
  const base = hubThreadBase(organizationId);
  const [picked, pick] = useState<{ workspaceId: string; computerId: string }>();
  const [preference, setPreference] = useState<{ workspaceId: string; computerId: string | null }>();
  const [fallback, setFallback] = useState<{ workspaceId: string; computerId?: string; hostedProvider?: string }>();
  const [pickedModel, setPickedModel] = useState<{ workspaceId: string; choice: ModelChoice }>();
  const [error, setError] = useState("");
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
  const modelAccess = useHubResource<ModelAccessResponse>(organizationId, "/model-access");
  const cloudConnections = useHubResource<{ settings?: { provider?: string }; enabledProviders?: string[]; cloudStart?: Record<string, { owner: boolean; providers: { id: string; allowed: boolean }[] }> }>(organizationId, "/hosted");
  const enabledClouds = useMemo(() => CLOUD_COMPUTERS.filter(c => cloudConnections.value?.enabledProviders?.includes(c.provider)), [cloudConnections.value?.enabledProviders]);
  const unavailable = useMemo(() => enabledClouds.flatMap(c => {
    const reason = exclude?.(c.id);
    return reason ? [{ id: c.id, name: c.name, reason }] : [];
  }), [enabledClouds, exclude]);
  const cloudOptions = useMemo(() => enabledClouds.filter(c => !unavailable.some(u => u.id === c.id)), [enabledClouds, unavailable]);
  const eligible = useMemo(() => computers.filter(
    (c) =>
      c.ownership !== "hosted" &&
      c.canUse &&
      c.availability !== "offline" &&
      !c.updateRequired &&
      (c.ownerUserId === memberId || (c.capabilities.providers?.length ?? 0) > 0) &&
      c.capabilities.workspaces.some(
        (w) => w.id === workspaceId || w.origin === workspaceOrigin,
      ),
  ), [computers, memberId, workspaceOrigin, workspaceId]);
  const optionsKnown = computersLoaded && !!cloudConnections.value;
  const options = useMemo(() => [...cloudOptions.map(c => c.id), ...eligible.map(c => c.computerId)], [cloudOptions, eligible]);
  const saved = preference?.workspaceId === workspaceId ? preference : undefined;
  const savedValid = !!saved?.computerId && options.includes(saved.computerId);
  const known = preferred && preferred !== "loading" ? preferred : undefined;
  const preferredValid = !!known && optionsKnown && options.includes(known.computerId);
  // Only when there is no usable preference does the hub have to choose, which
  // lists every computer and is the slowest read here.
  const needsFallback = !!workspaceId && !!saved && optionsKnown && !savedValid && !preferredValid && preferred !== "loading";
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
    if (!optionsKnown || preferred === "loading") return "";
    if (preferredValid) return known!.computerId;
    if (!saved) return "";
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
  const unresolved = !!workspaceId && optionsKnown && !!saved && !savedValid && !preferredValid && fallback?.workspaceId === workspaceId && !chosen;
  useEffect(() => {
    if (unresolved) setError("No computer is available for this workspace.");
  }, [unresolved]);
  const preferenceLoaded = !!selected || unresolved;
  // Reads keyed on the computer start with the one they will most likely end
  // on, so the model default and branch do not wait for the choice to settle.
  const likelyComputer = selected || (preferredValid ? known!.computerId : "") || saved?.computerId || (saved ? "" : snapshot?.computerId) || "";
  const defaults = useHubModelDefaults(organizationId, likelyComputer || undefined);
  const latchedDefaults = useRef(defaults.value);
  if (defaults.value) latchedDefaults.current = defaults.value;
  useEffect(() => { latchedDefaults.current = undefined; }, [workspaceId, organizationId]);
  const resolvedDefaults = defaults.value ?? latchedDefaults.current;
  const inheritedModel = resolveModelDefault(resolvedDefaults?.computer, { provider: "", model: "" });
  const usingCloud = !!cloudComputerProvider(selected);
  const usingCursorCloud = cloudComputerProvider(selected) === "cursor-cloud";
  // Your own ChatGPT sign-in, when you allow it in this organization. Nobody else's shows here.
  const codexAccount = useHubResource<{ available: boolean }>(organizationId, usingCloud && !usingCursorCloud ? "/chatgpt" : null, "/computers/live");
  const chatgpt = codexAccount.value?.available === true;
  const codexAccountPending = usingCloud && !usingCursorCloud && !codexAccount.value && !codexAccount.error;
  const cloudStart = usingCloud ? cloudConnections.value?.cloudStart?.[cloudComputerProvider(selected) ?? ""] : undefined;
  const allowedCloudRuntimes = cloudStart && !cloudStart.owner ? new Set(cloudStart.providers.filter(provider => provider.allowed).map(provider => provider.id)) : undefined;
  const resolvedChoice = hostedComposerChoice(modelAccess.value?.providers ?? [], inheritedModel, chatgpt);
  const preferredModel = known && selected === known.computerId && known.provider && known.model
    ? executionToChoice(known.provider, known.model, usingCloud)
    : undefined;
  const modelChoice = pickedModel?.workspaceId === workspaceId ? pickedModel.choice : preferredModel ?? resolvedChoice;
  const cloudModels = hostedModels(modelAccess.value?.providers ?? [], modelChoice, chatgpt).filter(provider => (chatgpt && provider.id === "codex") || cloudShareAllowsProvider(allowedCloudRuntimes, provider.id));
  const localModels = computerModels(computers.find(c => c.computerId === selected)?.capabilities.providers ?? []);
  const modelCatalogue = usingCursorCloud ? [] : usingCloud || !selected ? cloudModels : localModels;
  const cataloguePending = usingCloud && ((!modelAccess.value && !modelAccess.error) || codexAccountPending);
  const selectedChoice = modelCatalogue.some(p => p.id === modelChoice.provider && p.models.some(m => m.value === modelChoice.model))
    ? modelChoice
    : { provider: modelCatalogue[0]?.id ?? modelChoice.provider, model: modelCatalogue[0]?.models[0]?.value ?? modelChoice.model };
  const chosenProvider = modelCatalogue.find(p => p.id === selectedChoice.provider);
  const choiceValid = chosenProvider?.models.some(m => m.value === selectedChoice.model);
  const executionChoice = choiceValid ? hostedExecutionChoice(selectedChoice) : {};
  const modelAccessReady = !!modelAccess.value || !!modelAccess.error;
  const defaultsReady = defaults.value !== undefined || !!defaults.error;
  const computerName = cloudOptions.find(c => c.id === selected)?.name ?? eligible.find(c => c.computerId === selected)?.name ?? (preferenceLoaded ? "Computer unavailable" : "");
  // Once shown for a workspace, the model stays while a new computer's default
  // is read, rather than blinking out.
  const modelShown = useRef("");
  const modelKey = `${organizationId}:${workspaceId}`;
  const modelReady = !!selected && modelAccessReady && (defaultsReady || modelShown.current === modelKey);
  if (modelReady) modelShown.current = modelKey;
  /// Whether a start can go: a computer, its defaults read, and a model it runs.
  const canStart = !!memberId && !!selected && preferenceLoaded && !!resolvedDefaults
    && !(usingCloud && !usingCursorCloud && !modelAccess.value) && !codexAccountPending
    && (usingCursorCloud || !(usingCloud || selectedChoice.provider) || !!choiceValid);
  return {
    snapshot,
    modelAccess,
    cloudConnections,
    cloudOptions,
    unavailable,
    eligible,
    optionsKnown,
    saved,
    picked,
    pick,
    selected,
    preferenceLoaded,
    likelyComputer,
    defaults,
    resolvedDefaults,
    usingCloud,
    usingCursorCloud,
    modelCatalogue,
    cataloguePending,
    codexAccountPending,
    selectedChoice,
    chosenProvider,
    choiceValid,
    executionChoice,
    setPickedModel: (choice: ModelChoice) => setPickedModel({ workspaceId, choice }),
    computerName,
    modelReady,
    canStart,
    error,
    setError,
  };
}
