import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { HubKeyList, type KeyInput } from "./HubKeyList";
import { HubModelDefault } from "./HubModelDefault";
import { ProviderMark } from "./ProviderMark";
import { SettingsList, SettingsRow, SettingsSection, StateDot } from "./SettingsList";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch-base";
import type { ModelAccessResponse } from "./HubModelAccess";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import type { CloudConnections, CloudProvider } from "@/lib/cloud-providers";
import type { OwnModelAccessResponse } from "@/lib/hub-models";
import { apiError } from "@/lib/api-error";

const LABELS: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", router: "Router.com", openrouter: "OpenRouter" };

/// One cloud provider in one account: whether it is on, the keys it uses, the
/// default model for threads there, and what those threads can run.
export function HubCloudProviderPage({ organizationId, owner, provider, admin, onModelAccess, organizationAccess }: {
  organizationId: string;
  owner: { name: string; personal: boolean };
  provider: CloudProvider;
  admin: boolean;
  onModelAccess: () => void;
  organizationAccess?: ReactNode;
}) {
  const resource = useHubResource<CloudConnections>(organizationId, "/hosted");
  const [saved, setSaved] = useState<CloudConnections>();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  // The switch moves when you flip it; a failed save puts it back.
  const [flipping, setFlipping] = useState<boolean | null>(null);
  useEffect(() => setSaved(undefined), [organizationId]);
  const state = saved ?? resource.value;
  const keys = state?.providerKeys?.[provider.id] ?? [];
  const placements = state?.cloudPlacements?.filter((placement) => placement.provider === provider.id) ?? [];
  const configured = owner.personal ? !!state?.connections?.includes(provider.id) || keys.length > 0 : placements.length > 0;
  const enabled = owner.personal ? !!state?.enabledProviders?.includes(provider.id) : placements.length > 0;
  useEffect(() => { if (state && !configured && admin) setAdding(true); }, [state, configured, admin]);
  const path = `${hubThreadBase(organizationId)}/cloud-connection`;
  const refresh = async () => setSaved(await hubRequest<CloudConnections>(`${hubThreadBase(organizationId)}/hosted`));
  const run = async (work: () => Promise<unknown>, failed: string) => {
    setBusy(true);
    try { await work(); await refresh(); }
    catch (cause) { toast.error(failed, { description: apiError(cause) }); }
    finally { setBusy(false); }
  };
  const save = (input: KeyInput) => run(async () => {
    const body: Record<string, string> = { provider: provider.id, name: input.name };
    for (const field of provider.fields) if (input.values[field.id]?.trim()) body[field.id] = input.values[field.id]!.trim();
    if (input.keyId) await hubRequest(`${path}/keys/${encodeURIComponent(input.keyId)}`, "PATCH", body);
    else await hubRequest(`${path}/keys`, "POST", body);
    // A first key turns the provider on, so saving is the whole setup.
    if (!configured) await hubRequest(path, "PATCH", { provider: provider.id, enabled: true });
  }, `Couldn't save your ${provider.keyLabel}`);
  const Icon = provider.icon;
  const status = !state ? "" : !configured ? "Not set up" : enabled ? "On" : "Off";
  return <div className="mx-auto flex w-full max-w-[760px] flex-col gap-9 px-4 pt-9 pb-10 sm:px-10">
    <div className="flex min-w-0 items-center gap-3.5">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border bg-muted"><Icon className="size-5" /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="truncate text-[22px] leading-7 font-semibold tracking-[-0.02em]">{provider.name}</h1>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[13px] leading-[18px] text-muted-foreground">
          {status && <StateDot on={configured && enabled}>{status}</StateDot>}
          <span aria-hidden>·</span>
          <span>{owner.personal ? "Personal" : owner.name}</span>
        </p>
      </div>
      {configured && <Switch aria-label={`Run threads on ${provider.name}`} checked={flipping ?? enabled} disabled={!admin || (busy && flipping === null)} onCheckedChange={next => { setFlipping(next); void run(() => hubRequest(path, "PATCH", { provider: provider.id, enabled: next }), `Couldn't turn ${provider.name} ${next ? "on" : "off"}`).finally(() => setFlipping(null)); }} />}
    </div>
    <p className="-mt-6 text-[13px] leading-[18px] text-muted-foreground">{provider.runs}</p>
    {state && !state.connections && <p role="status" className="text-[13px] text-muted-foreground">Update the Remy service to save cloud connections.</p>}
    {admin && configured && enabled && provider.id !== "cursor-cloud" && <SettingsSection id={`default-${provider.id}`} title="Default model">
      <HubModelDefault organizationId={organizationId} computerId={`cloud:${provider.id}`} title={`New threads on ${provider.name}`} />
    </SettingsSection>}
    <SettingsSection
      id={`keys-${provider.id}`}
      title={admin ? `${provider.keyLabel}s` : "Available keys"}
      description={admin ? "New threads use the active one. Keys are encrypted and never reach a computer." : "Read-only here. Change your enrollments in Organizations."}
      action={admin && keys.length > 0 && !adding && <Button size="sm" variant="ghost" className="h-7 gap-1.5 rounded-lg px-2.5 text-xs" disabled={busy} onClick={() => setAdding(true)}><Plus className="size-3.5" />Add</Button>}
    >
      {admin ? <HubKeyList
        label={provider.keyLabel}
        keys={keys}
        fields={provider.fields}
        busy={busy}
        readOnly={!admin}
        adding={adding}
        setAdding={setAdding}
        onSave={save}
        onRemove={keyId => run(() => hubRequest(`${path}/keys/${encodeURIComponent(keyId)}`, "DELETE", { provider: provider.id }), `Couldn't remove that ${provider.keyLabel}`)}
        onActivate={keys.length > 1 ? keyId => run(() => hubRequest(`${path}/keys/${encodeURIComponent(keyId)}`, "PATCH", { provider: provider.id, active: true }), `Couldn't switch ${provider.keyLabel}s`) : undefined}
      /> : placements.length ? <SettingsList label={`${provider.name} keys available to you`}>
        {placements.map((placement) => <SettingsRow key={placement.id} title={placement.keyName} description={placement.own ? "Yours" : placement.owner} />)}
      </SettingsList> : <p className="text-[13px] text-muted-foreground">No key is available to you.</p>}
      {admin && <p className="text-xs leading-4 text-muted-foreground">Get one from <a className="text-info hover:underline" href={provider.href} target="_blank" rel="noreferrer" data-link>{provider.hrefLabel}</a>.</p>}
    </SettingsSection>
    {organizationAccess}
    {configured && provider.id !== "cursor-cloud" && <CanRun organizationId={organizationId} onModelAccess={onModelAccess} />}
  </div>;
}

/// The models a thread here can start on, read from model access.
function CanRun({ organizationId, onModelAccess }: { organizationId: string; onModelAccess: () => void }) {
  const access = useHubResource<ModelAccessResponse>(organizationId, "/model-access");
  const chatgpt = useHubResource<{ available: boolean }>(organizationId, "/chatgpt", "/computers/live");
  const own = useHubResource<OwnModelAccessResponse>(organizationId, "/own-model-access", "/computers/live");
  const chips = [
    ...(chatgpt.value?.available ? [{ id: "codex", label: "Codex with ChatGPT" }] : []),
    ...(access.value?.providers ?? []).filter(entry => entry.enabled && entry.configured).map(entry => ({ id: entry.id, label: LABELS[entry.id] ?? entry.id })),
    ...(own.value?.personal ? [] : own.value?.providers ?? []).filter(entry => entry.id !== "chatgpt" && entry.configured && entry.allowed).map(entry => ({ id: entry.id, label: `Your ${LABELS[entry.id] ?? entry.id}` })),
    ...(own.value?.personal ? [] : own.value?.enrolled ?? []).map(entry => ({ id: entry.provider, label: `${LABELS[entry.provider] ?? entry.provider} · ${entry.owner} · ${entry.keyName}` })),
  ];
  return <SettingsSection
    id="cloud-can-run"
    title="What it can run"
    description="From model access, which every cloud provider in this account shares."
    action={<Button size="sm" variant="ghost" className="h-7 gap-1 rounded-lg px-2.5 text-xs" data-link onClick={onModelAccess}>Model access<ChevronRight className="size-3.5" /></Button>}
  >
    {chips.length
      ? <ul className="flex flex-wrap gap-2">{chips.map(chip => <li key={chip.label} className="flex h-8 items-center gap-2 rounded-lg border px-3 text-xs"><ProviderMark provider={chip.id} className="size-3.5" />{chip.label}</li>)}</ul>
      : <p className="text-[13px] text-muted-foreground">Nothing yet. Sign in to ChatGPT or add an API key in model access.</p>}
  </SettingsSection>;
}
