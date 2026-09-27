import { useState } from "react";
import { Cloud } from "lucide-react";
import { toast } from "sonner";
import { apiError } from "@/lib/api-error";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { cloudProvider } from "@/lib/cloud-providers";
import { HubOwnModelAccess } from "./HubOwnModelAccess";
import { RowMark, SettingsList, SettingsRow, SettingsSection } from "./SettingsList";
import { Button } from "./ui/button";
import { Switch } from "./ui/switch-base";
import { ToggleChip } from "./ui/toggle-chip-base";

type SharedStartProvider = { id: string; label: string; allowed: boolean };
type Shared = { shared: boolean; available: boolean; sharedBy: string | null; canShare: boolean; canRevoke: boolean; providers: SharedStartProvider[] };
type SharedComputer = Shared & { id: string; name: string; icon: string; platform: string };
type SharedCloud = Shared & { provider: string };
type ComputeShares = { canManage: boolean; computers: SharedComputer[]; cloudConnections: SharedCloud[] };

/// Organization → Computers: your own model access here, then everything
/// shared into this organization. A share is its owner's to make and to scope;
/// an admin can only stop someone else's.
export function HubOrganizationComputers({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const resource = useHubResource<ComputeShares>(organizationId, "/compute-shares", "/computers/live");
  const [saving, setSaving] = useState("");
  const run = async (key: string, work: () => Promise<unknown>, failed: string) => {
    setSaving(key);
    try { await work(); }
    catch (cause) { toast.error(failed, { description: apiError(cause) }); }
    finally { setSaving(""); }
  };
  const base = `${hubThreadBase(organizationId)}/compute-shares`;
  const share = (kind: "computers" | "cloud", id: string, shared: boolean, name: string) =>
    run(`${kind}:${id}`, () => hubRequest(`${base}/${kind}/${encodeURIComponent(id)}`, shared ? "DELETE" : "PUT"), shared ? `Couldn't stop sharing ${name}` : `Couldn't share ${name}`);
  const scope = (kind: "computers" | "cloud", id: string, providers: SharedStartProvider[], providerId: string, allowed: boolean) =>
    run(`provider:${kind}:${id}:${providerId}`, () => hubRequest(`${base}/${kind}/${encodeURIComponent(id)}`, "PATCH", {
      startProviders: providers.filter(provider => provider.id === providerId ? allowed : provider.allowed).map(provider => provider.id),
    }), "Couldn't change what members can start with");
  const value = resource.value;
  const rows = value ? [
    ...value.cloudConnections.map(connection => ({ kind: "cloud" as const, id: connection.provider, name: cloudProvider(connection.provider)?.name ?? connection.provider, icon: <Cloud />, entry: connection, detail: connection.canShare ? `${connection.shared ? "Shared by you" : "Only you"} · Your keys stay in Personal` : `Shared by ${connection.sharedBy ?? "a member"}` })),
    ...value.computers.map(computer => {
      const Icon = deviceIcon(computer.icon as DeviceIconId);
      return { kind: "computers" as const, id: computer.id, name: computer.name, icon: <Icon />, entry: computer, detail: `${computer.available ? "Online" : "Offline"} · ${computer.canShare ? computer.shared ? "Shared by you" : `Only you · You still see it in ${organizationName}'s computer picker` : `Shared by ${computer.sharedBy ?? "a member"}`}` };
    }),
  ] : [];
  return <div className="flex min-w-0 max-w-[760px] flex-col gap-9 p-6">
    <HubOwnModelAccess organizationId={organizationId} organizationName={organizationName} />
    <SettingsSection id={`shared-${organizationId}`} title={`Shared with ${organizationName}`} description="Members start new threads with the providers you turn on. They can always reply on threads already running.">
      {resource.error && <p role="alert" className="text-[13px] text-destructive">{resource.error}</p>}
      {resource.stale && <p role="status" className="text-[13px] text-muted-foreground">You're reading the last saved sharing settings.</p>}
      {!value && !resource.error && <p role="status" className="text-[13px] text-muted-foreground">Reading computers…</p>}
      {value && rows.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing to share yet. Connect a computer or a cloud provider in Personal first.</p>}
      {rows.length > 0 && <SettingsList label={`Shared with ${organizationName}`}>
        {rows.map(({ kind, id, name, icon, entry, detail }) => {
          const canToggle = entry.shared ? entry.canShare || entry.canRevoke : entry.canShare;
          return <SettingsRow
            key={`${kind}:${id}:${entry.sharedBy ?? "mine"}`}
            media={<RowMark>{icon}</RowMark>}
            title={name}
            description={detail}
            below={entry.shared && entry.providers.length > 0 && <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="mr-1 text-xs text-muted-foreground">Members can start with</span>
              {entry.providers.map(provider => <ToggleChip key={provider.id} pressed={provider.allowed} disabled={!entry.canShare || !!saving} aria-label={`Members can start ${provider.label} on ${name}`} onPressedChange={allowed => void scope(kind, id, entry.providers, provider.id, allowed)}>{provider.label}</ToggleChip>)}
            </div>}
          >
            {entry.canShare
              ? <Switch aria-label={`Share ${name} with ${organizationName}`} checked={entry.shared} disabled={!canToggle || !!saving} onCheckedChange={() => void share(kind, id, entry.shared, name)} />
              : entry.canRevoke && <Button size="sm" variant="outline" className="h-7 rounded-lg px-2.5 text-xs" disabled={!!saving} onClick={() => void share(kind, id, true, name)}>Stop sharing</Button>}
          </SettingsRow>;
        })}
      </SettingsList>}
    </SettingsSection>
  </div>;
}
