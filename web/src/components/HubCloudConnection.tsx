import { HubModelDefault } from "./HubModelDefault";
import { HubNamedKeys, type NamedKey } from "./HubNamedKeys";
import { Skeleton } from "@/components/ui/skeleton";
import { Cloud, Box, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useHubResource } from "@/lib/hub-organization";
import { toast } from "sonner";

const providers = [
  { id: "fly-sprites", name: "Fly.io Sprites", href: "https://sprites.dev", fields: [{ id: "token", label: "Sprites token" }], icon: Cloud },
  { id: "modal", name: "Modal", href: "https://modal.com/settings", fields: [{ id: "tokenId", label: "Token ID", secret: false }, { id: "tokenSecret", label: "Token secret" }], icon: Box },
  { id: "cursor-cloud", name: "Cursor Cloud", href: "https://cursor.com/dashboard", fields: [{ id: "token", label: "API key" }], icon: Sparkles, description: "Cursor clones this workspace from its git remote onto a Cursor-hosted VM." },
] as const;
type Provider = (typeof providers)[number];
type Connections = { connections?: string[]; enabledProviders?: string[]; providerKeys?: Record<string, NamedKey[]> };
export function HubCloudConnection({ organizationId, admin, onChange }: { organizationId: string; admin: boolean; onChange?: (providers: string[]) => void }) {
  const resource = useHubResource<Connections>(organizationId, "/hosted");
  const [saved, setSaved] = useState<Connections>();
  useEffect(() => setSaved(undefined), [organizationId]);
  const state = saved ?? resource.value;
  const refresh = async () => {
    const next = await hubRequest<Connections>(`${hubThreadBase(organizationId)}/hosted`);
    setSaved(next); onChange?.(next.enabledProviders ?? []);
  };
  if (!state) return resource.error ? <p role="alert">{resource.error}</p> : <Skeleton className="h-28 w-full" aria-label="Loading cloud providers" />;
  return <section className="flex flex-col gap-4" aria-label="Cloud connections">
    <div className="space-y-1"><h2 className="text-sm font-medium">Providers</h2><p className="text-sm text-muted-foreground">Run threads in your own cloud accounts.</p></div>
    {resource.value && !resource.value.connections && <p role="status" className="text-sm text-muted-foreground">Update the Remy service to save cloud connections.</p>}
    <div className="divide-y rounded-lg border">
    {providers.map(provider => <ProviderConnection key={provider.id} provider={provider} organizationId={organizationId} admin={admin} configured={!!state?.connections?.includes(provider.id) || (state?.providerKeys?.[provider.id]?.length ?? 0) > 0} enabled={!!state?.enabledProviders?.includes(provider.id)} keys={state?.providerKeys?.[provider.id] ?? []} supported={!!state?.connections} refresh={refresh} />)}
    </div>
  </section>;
}
function ProviderConnection({ provider, organizationId, admin, configured, enabled, keys, supported, refresh }: {
  provider: Provider; organizationId: string; admin: boolean; configured: boolean; enabled: boolean; keys: NamedKey[]; supported: boolean; refresh: () => Promise<void>;
}) {
  const [setupRequested, setSetupRequested] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const expanded = pendingEnabled ?? (enabled || (!configured && setupRequested));
  const [busy, setBusy] = useState(false);
  const path = `${hubThreadBase(organizationId)}/cloud-connection`;
  const Icon: LucideIcon = provider.icon;
  const run = async (work: () => Promise<void>, failed: string) => {
    setBusy(true);
    try { await work(); await refresh(); }
    catch { toast.error(failed, { description: "Your cloud connection could not be saved. Try again." }); }
    finally { setBusy(false); }
  };
  return <form className="flex min-w-0 flex-col gap-4 p-4" aria-label={`${provider.name} connection`} onSubmit={event => event.preventDefault()}>
    <Field orientation="horizontal">
      <FieldLabel htmlFor={`cloud-${provider.id}`} className="min-w-0 gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        {provider.name}
      </FieldLabel>
      <span className="shrink-0 text-xs text-muted-foreground">{expanded ? (configured ? "Enabled" : "Setup required") : "Off"}</span>
      <Switch id={`cloud-${provider.id}`} checked={expanded} disabled={!admin || !supported || busy} onCheckedChange={async value => {
        if (!configured) { setSetupRequested(value); return; }
        setPendingEnabled(value); setBusy(true);
        try { await hubRequest(path, "PATCH", { provider: provider.id, enabled: value }); await refresh(); }
        catch { toast.error("Couldn't save that provider", { description: "Your provider preference could not be saved. Try again." }); }
        finally { setPendingEnabled(null); setBusy(false); }
      }} />
    </Field>
    {expanded && <div className="flex min-w-0 flex-col gap-3 border-t pt-4 sm:pl-7">
    {!configured && <FieldDescription>{"description" in provider ? provider.description : "Save your credentials to finish enabling this provider."}</FieldDescription>}
    {configured && "description" in provider && <FieldDescription>{provider.description}</FieldDescription>}
    {admin && <>
      <HubNamedKeys
        label={provider.name}
        keys={keys}
        fields={[...provider.fields]}
        busy={busy}
        onSave={(input) => run(async () => {
          const body: { provider: string; name: string; token?: string; tokenId?: string; tokenSecret?: string } = {
            provider: provider.id,
            name: input.name,
          };
          if (input.values.token?.trim()) body.token = input.values.token.trim();
          if (input.values.tokenId?.trim()) body.tokenId = input.values.tokenId.trim();
          if (input.values.tokenSecret?.trim()) body.tokenSecret = input.values.tokenSecret.trim();
          if (input.keyId) await hubRequest(`${path}/keys/${encodeURIComponent(input.keyId)}`, "PATCH", body);
          else await hubRequest(`${path}/keys`, "POST", body);
        }, "Couldn't save that cloud connection")}
        onRemove={(keyId) => run(async () => { await hubRequest(`${path}/keys/${encodeURIComponent(keyId)}`, "DELETE", { provider: provider.id }); }, "Couldn't save that cloud connection")}
        onActivate={keys.length > 1 ? (keyId) => run(async () => { await hubRequest(`${path}/keys/${encodeURIComponent(keyId)}`, "PATCH", { provider: provider.id, active: true }); }, "Couldn't save that cloud connection") : undefined}
      />
      <FieldDescription>Your credentials are encrypted and kept out of your computers.</FieldDescription>
      <Button asChild variant="link" className="h-auto self-start p-0"><a target="_blank" rel="noreferrer" href={provider.href}>Open {provider.name}</a></Button>
    </>}
    {configured && provider.id !== "cursor-cloud" && <HubModelDefault organizationId={organizationId} computerId={`cloud:${provider.id}`} />}
    {!admin && <p>Ask an organization administrator to manage this connection.</p>}
    </div>}
  </form>;
}
