import { useState } from "react";
import { Cloud } from "lucide-react";
import { apiError } from "@/lib/api-error";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle, ItemActions } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";

type SharedStartProvider = {
  id: string;
  label: string;
  allowed: boolean;
};

type SharedComputer = {
  id: string;
  name: string;
  icon: string;
  platform: string;
  shared: boolean;
  available: boolean;
  sharedBy: string | null;
  canShare: boolean;
  canRevoke: boolean;
  providers: SharedStartProvider[];
};

type SharedCloud = {
  provider: string;
  shared: boolean;
  available: boolean;
  sharedBy: string | null;
  canShare: boolean;
  canRevoke: boolean;
  providers: SharedStartProvider[];
};

type ComputeShares = {
  canManage: boolean;
  computers: SharedComputer[];
  cloudConnections: SharedCloud[];
};

const cloudLabel = (provider: string) => provider === "fly-sprites" ? "Fly.io Sprites" : provider === "modal" ? "Modal" : provider === "cursor-cloud" ? "Cursor Cloud" : provider;

export function HubOrganizationComputers({ organizationId }: { organizationId: string }) {
  const resource = useHubResource<ComputeShares>(organizationId, "/compute-shares", "/computers/live");
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const updateShare = async (kind: "computers" | "cloud", id: string, shared: boolean) => {
    const key = `${kind}:${id}`;
    setSaving(key);
    setError("");
    try {
      await hubRequest(`${hubThreadBase(organizationId)}/compute-shares/${kind}/${encodeURIComponent(id)}`, shared ? "DELETE" : "PUT");
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setSaving("");
    }
  };
  const updateProviders = async (kind: "computers" | "cloud", id: string, providers: SharedStartProvider[], providerId: string, allowed: boolean) => {
    const key = `provider:${kind}:${id}:${providerId}`;
    setSaving(key);
    setError("");
    try {
      const startProviders = providers.filter(provider => provider.id === providerId ? allowed : provider.allowed).map(provider => provider.id);
      await hubRequest(`${hubThreadBase(organizationId)}/compute-shares/${kind}/${encodeURIComponent(id)}`, "PATCH", { startProviders });
    } catch (cause) {
      setError(apiError(cause));
    } finally {
      setSaving("");
    }
  };
  const value = resource.value;
  const empty = value && value.computers.length === 0 && value.cloudConnections.length === 0;
  return <section className="flex min-w-0 flex-col gap-6 p-6" aria-label="Organization computers">
    <Field>
      <FieldLabel>Computers</FieldLabel>
      <FieldDescription>Others start with the providers you turn on, and can still reply on work already running.</FieldDescription>
    </Field>
    {(error || resource.error) && <p role="alert" className="text-sm text-destructive">{error || resource.error}</p>}
    {resource.stale && <p role="status" className="text-sm text-muted-foreground">You’re reading the last saved computer sharing settings.</p>}
    {!value && !resource.error && <p role="status" className="text-sm text-muted-foreground">Reading computers…</p>}
    {empty && <Field>
      <FieldLabel>No computers available</FieldLabel>
      <FieldDescription>Connect a computer or cloud provider in Personal first.</FieldDescription>
    </Field>}
    {value && value.computers.length > 0 && <Field>
      <FieldLabel>Connected computers</FieldLabel>
      <ItemGroup className="gap-3">
        {value.computers.map(computer => {
          const Icon = deviceIcon(computer.icon as DeviceIconId);
          const canToggleShare = computer.shared ? computer.canShare || computer.canRevoke : computer.canShare;
          return <Item key={computer.id} variant="outline" className="flex-col items-stretch">
            <div className="flex min-w-0 items-center gap-4">
              <ItemMedia variant="icon"><Icon /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="whitespace-normal break-words">{computer.name}</ItemTitle>
                <ItemDescription>{computer.available ? "Online" : "Offline"}{computer.sharedBy ? ` · Shared by ${computer.sharedBy}` : ""}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch aria-label={`Share ${computer.name}`} checked={computer.shared} disabled={!canToggleShare || !!saving} onCheckedChange={() => void updateShare("computers", computer.id, computer.shared)} />
              </ItemActions>
            </div>
            {computer.shared && computer.providers.length > 0 && <StartProviderSwitches id={computer.id} name={computer.name} providers={computer.providers} canShare={computer.canShare} saving={!!saving} onToggle={(providerId, allowed) => void updateProviders("computers", computer.id, computer.providers, providerId, allowed)} />}
          </Item>;
        })}
      </ItemGroup>
    </Field>}
    {value && value.cloudConnections.length > 0 && <Field>
      <FieldLabel>Cloud connections</FieldLabel>
      <ItemGroup className="gap-3">
        {value.cloudConnections.map(connection => {
          const label = cloudLabel(connection.provider);
          const canToggleShare = connection.shared ? connection.canShare || connection.canRevoke : connection.canShare;
          return <Item key={`${connection.provider}:${connection.sharedBy ?? "personal"}`} variant="outline" className="flex-col items-stretch">
            <div className="flex min-w-0 items-center gap-4">
              <ItemMedia variant="icon"><Cloud /></ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="whitespace-normal break-words">{label}</ItemTitle>
                <ItemDescription>{connection.available ? "Available" : "Unavailable"}{connection.sharedBy ? ` · Shared by ${connection.sharedBy}` : " · Credentials stay in Personal."}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch aria-label={`Share ${label}`} checked={connection.shared} disabled={!canToggleShare || !!saving} onCheckedChange={() => void updateShare("cloud", connection.provider, connection.shared)} />
              </ItemActions>
            </div>
            {connection.shared && connection.providers.length > 0 && <StartProviderSwitches id={connection.provider} name={label} providers={connection.providers} canShare={connection.canShare} saving={!!saving} onToggle={(providerId, allowed) => void updateProviders("cloud", connection.provider, connection.providers, providerId, allowed)} />}
          </Item>;
        })}
      </ItemGroup>
    </Field>}
  </section>;
}

function StartProviderSwitches({ id, name, providers, canShare, saving, onToggle }: {
  id: string;
  name: string;
  providers: SharedStartProvider[];
  canShare: boolean;
  saving: boolean;
  onToggle: (providerId: string, allowed: boolean) => void;
}) {
  return <ItemGroup className="gap-2 border-t pt-3">
    {providers.map(provider => (
      <Field key={provider.id} orientation="horizontal" className="min-w-0">
        <FieldLabel htmlFor={`start-${id}-${provider.id}`} className="min-w-0">{provider.label}</FieldLabel>
        <Switch id={`start-${id}-${provider.id}`} aria-label={`Start ${provider.label} on ${name}`} checked={provider.allowed} disabled={!canShare || saving} onCheckedChange={allowed => onToggle(provider.id, allowed)} />
      </Field>
    ))}
  </ItemGroup>;
}
