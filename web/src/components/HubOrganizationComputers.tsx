import { useState } from "react";
import { Cloud } from "lucide-react";
import { apiError } from "@/lib/api-error";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle, ItemActions } from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";

type SharedComputer = {
  id: string;
  name: string;
  icon: string;
  platform: string;
  shared: boolean;
  available: boolean;
  sharedBy: string | null;
};

type SharedCloud = {
  provider: string;
  shared: boolean;
  available: boolean;
  sharedBy: string | null;
};

type ComputeShares = {
  canManage: boolean;
  computers: SharedComputer[];
  cloudConnections: SharedCloud[];
};

const cloudLabel = (provider: string) => provider === "fly-sprites" ? "Fly.io Sprites" : provider === "modal" ? "Modal" : provider;

export function HubOrganizationComputers({ organizationId }: { organizationId: string }) {
  const resource = useHubResource<ComputeShares>(organizationId, "/compute-shares", "/computers/live");
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const update = async (kind: "computers" | "cloud", id: string, shared: boolean) => {
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
  const value = resource.value;
  const empty = value && value.computers.length === 0 && value.cloudConnections.length === 0;
  return <section className="flex min-w-0 flex-col gap-6 p-6" aria-label="Organization computers">
    <Field>
      <FieldLabel>Computers</FieldLabel>
      <FieldDescription>Organization members can use what you share. Connection credentials stay private.</FieldDescription>
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
          return <Item key={computer.id} variant="outline">
            <ItemMedia variant="icon"><Icon /></ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="whitespace-normal break-words">{computer.name}</ItemTitle>
              <ItemDescription>{computer.available ? "Online" : "Offline"}{computer.sharedBy ? ` · Shared by ${computer.sharedBy}` : ""}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch aria-label={`Share ${computer.name}`} checked={computer.shared} disabled={!value.canManage || !!saving} onCheckedChange={() => void update("computers", computer.id, computer.shared)} />
            </ItemActions>
          </Item>;
        })}
      </ItemGroup>
    </Field>}
    {value && value.cloudConnections.length > 0 && <Field>
      <FieldLabel>Cloud connections</FieldLabel>
      <ItemGroup className="gap-3">
        {value.cloudConnections.map(connection => {
          const label = cloudLabel(connection.provider);
          return <Item key={`${connection.provider}:${connection.sharedBy ?? "personal"}`} variant="outline">
            <ItemMedia variant="icon"><Cloud /></ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="whitespace-normal break-words">{label}</ItemTitle>
              <ItemDescription>{connection.available ? "Available" : "Unavailable"}{connection.sharedBy ? ` · Shared by ${connection.sharedBy}` : " · Credentials stay in Personal."}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Switch aria-label={`Share ${label}`} checked={connection.shared} disabled={!value.canManage || !!saving} onCheckedChange={() => void update("cloud", connection.provider, connection.shared)} />
            </ItemActions>
          </Item>;
        })}
      </ItemGroup>
    </Field>}
  </section>;
}
