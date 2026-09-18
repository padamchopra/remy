import { HubModelDefault } from "./HubModelDefault";
import { Skeleton } from "@/components/ui/skeleton";
import { Cloud, Box } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useHubResource } from "@/lib/hub-organization";
import { toast } from "sonner";

const providers = [{ id: "fly-sprites", name: "Fly.io Sprites", href: "https://sprites.dev" }, { id: "modal", name: "Modal", href: "https://modal.com/settings" }] as const;
type Connections = { connections?: string[]; enabledProviders?: string[] };
export function HubCloudConnection({ organizationId, admin, onChange }: { organizationId: string; admin: boolean; onChange?: (providers: string[]) => void }) {
  const resource = useHubResource<Connections>(organizationId, "/hosted");
  const [saved, setSaved] = useState<Connections>();
  useEffect(() => setSaved(undefined), [resource.value]);
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
    {providers.map(provider => <ProviderConnection key={provider.id} provider={provider} organizationId={organizationId} admin={admin} configured={!!state?.connections?.includes(provider.id)} enabled={!!state?.enabledProviders?.includes(provider.id)} supported={!!state?.connections} refresh={refresh} />)}
    </div>
  </section>;
}
function ProviderConnection({ provider, organizationId, admin, configured, enabled, supported, refresh }: {
  provider: typeof providers[number]; organizationId: string; admin: boolean; configured: boolean; enabled: boolean; supported: boolean; refresh: () => Promise<void>;
}) {
  const [setupRequested, setSetupRequested] = useState(false);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const expanded = pendingEnabled ?? (enabled || (!configured && setupRequested));
  const [editing, setEditing] = useState(false);
  const [tokenId, setTokenId] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const path = `${hubThreadBase(organizationId)}/cloud-connection`;
  return <form className="flex min-w-0 flex-col gap-4 p-4" aria-label={`${provider.name} connection`} onSubmit={async event => {
    event.preventDefault(); setBusy(true);
    try {
      await hubRequest(path, "PUT", provider.id === "modal" ? { provider: provider.id, tokenId, tokenSecret: token, enabled: true } : { provider: provider.id, token, enabled: true });
      setToken(""); setTokenId(""); setEditing(false); await refresh(); setSetupRequested(false);
    } catch { toast.error("Couldn't save that cloud connection", { description: "Your cloud connection could not be saved. Try again." }); }
    finally { setBusy(false); }
  }}>
    <Field orientation="horizontal">
      <FieldLabel htmlFor={`cloud-${provider.id}`} className="min-w-0 gap-3">
        {provider.id === "modal" ? <Box className="size-4 shrink-0 text-muted-foreground" /> : <Cloud className="size-4 shrink-0 text-muted-foreground" />}
        {provider.name}
      </FieldLabel>
      <span className="shrink-0 text-xs text-muted-foreground">{pendingEnabled !== null ? "Saving…" : expanded ? (configured ? "Enabled" : "Setup required") : "Off"}</span>
      <Switch id={`cloud-${provider.id}`} checked={expanded} disabled={!admin || !supported || busy} onCheckedChange={async value => {
        if (!configured) { setSetupRequested(value); if (!value) { setToken(""); setTokenId(""); } return; }
        setPendingEnabled(value); setBusy(true);
        try { await hubRequest(path, "PATCH", { provider: provider.id, enabled: value }); await refresh(); }
        catch { toast.error("Couldn't save that provider", { description: "Your provider preference could not be saved. Try again." }); }
        finally { setPendingEnabled(null); setBusy(false); }
      }} />
    </Field>
    {expanded && <div className="flex min-w-0 flex-col gap-3 border-t pt-4 sm:pl-7">
    {!configured && <FieldDescription>Save your credentials to finish enabling this provider.</FieldDescription>}
    {admin && (!configured || editing) && <>
      {provider.id === "modal" && <Field><FieldLabel htmlFor="modal-token-id">Token ID</FieldLabel><Input id="modal-token-id" autoComplete="off" value={tokenId} onChange={e => setTokenId(e.target.value)} disabled={busy} required /></Field>}
      <Field><FieldLabel htmlFor={`${provider.id}-token`}>{provider.id === "modal" ? "Token secret" : "Sprites token"}</FieldLabel><Input id={`${provider.id}-token`} type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} disabled={busy} required /><FieldDescription>Your credentials are encrypted and kept out of your computers.</FieldDescription></Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
      <Button asChild variant="link" className="h-auto p-0"><a target="_blank" rel="noreferrer" href={provider.href}>Open {provider.name}</a></Button>
      <Button className="self-start" disabled={!supported || busy || !token.trim() || (provider.id === "modal" && !tokenId.trim())}>{busy ? "Saving connection…" : "Save connection"}</Button>
      </div>
      {configured && <Button type="button" variant="ghost" onClick={() => { setEditing(false); setToken(""); setTokenId(""); }}>Cancel</Button>}
    </>}
    {admin && configured && !editing && <div className="flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">Credentials saved</span><Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>Update credentials</Button></div>}
    {configured && <HubModelDefault organizationId={organizationId} computerId={`cloud:${provider.id}`} />}
    {!admin && <p>Ask an organization administrator to manage this connection.</p>}
    </div>}
  </form>;
}
