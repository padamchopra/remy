import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessMark } from "./AccessMark";
import { apiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useHubResource } from "@/lib/hub-organization";

type ComputerModelKey = { id: string; label: string; runtime: string; configured: boolean };
type ComputerModelKeys = { providers: ComputerModelKey[] };

export function HubComputerModelKeys({ organizationId, computerId }: { organizationId: string; computerId: string }) {
  const path = `/computers/${encodeURIComponent(computerId)}/model-keys`;
  const resource = useHubResource<ComputerModelKeys>(organizationId, path);
  const [providers, setProviders] = useState<ComputerModelKey[]>([]);
  const [editing, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (resource.value) setProviders(resource.value.providers); }, [resource.value]);

  const save = async (id: string, apiKey: string | null) => {
    setBusy(true);
    try {
      const result = await hubRequest<ComputerModelKeys>(`${hubThreadBase(organizationId)}${path}`, "PUT", { id, apiKey });
      setProviders(result.providers);
      setEditing(undefined);
      toast.success(apiKey ? "Your key is on this computer." : "Your key is removed from this computer.");
    } catch (error) {
      toast.error("Couldn’t save this key", { description: apiError(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Provider keys" className="mt-2 min-w-0 space-y-3">
      <Field>
        <FieldLabel>Provider keys</FieldLabel>
        <FieldDescription>Give this computer a key instead of signing Claude Code or Codex in on the machine itself.</FieldDescription>
      </Field>
      {resource.error && <p role="alert" className="text-sm text-muted-foreground">{resource.error}</p>}
      {!resource.value && !resource.error && (
        <div aria-label="Loading provider keys" role="status" className="space-y-2">
          <Skeleton className="h-[54px] w-full rounded-xl" />
          <Skeleton className="h-[54px] w-full rounded-xl" />
        </div>
      )}
      {resource.value && (
        <ItemGroup className="min-w-0 gap-2">
          {providers.map((provider) => (
            <Item key={provider.id} variant="outline" className="min-w-0 flex-col items-stretch">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <ItemMedia variant="icon"><AccessMark id={provider.id} /></ItemMedia>
                <ItemContent className="min-w-0 grow basis-[8rem]">
                  <ItemTitle className="w-full whitespace-normal break-words">{provider.label}</ItemTitle>
                  <ItemDescription>
                    {provider.configured ? `${provider.runtime} uses this key.` : `${provider.runtime} uses the sign-in on this computer.`}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="min-w-0 shrink flex-wrap">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(editing === provider.id ? undefined : provider.id)}>
                    {provider.configured ? "Replace key" : "Add key"}
                  </Button>
                  {provider.configured && (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save(provider.id, null)}>
                      Remove
                    </Button>
                  )}
                </ItemActions>
              </div>
              {editing === provider.id && <KeyForm label={provider.label} busy={busy} onCancel={() => setEditing(undefined)} onSave={(apiKey) => save(provider.id, apiKey)} />}
            </Item>
          ))}
        </ItemGroup>
      )}
    </section>
  );
}

function KeyForm({ label, busy, onCancel, onSave }: { label: string; busy: boolean; onCancel: () => void; onSave: (apiKey: string) => Promise<void> }) {
  const [apiKey, setApiKey] = useState("");
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Field>
        <FieldLabel htmlFor={`${label}-computer-key`}>API key</FieldLabel>
        <Input
          id={`${label}-computer-key`}
          aria-label={`${label} API key`}
          type="password"
          autoComplete="new-password"
          value={apiKey}
          maxLength={8192}
          disabled={busy}
          onChange={(event) => setApiKey(event.target.value)}
          required
        />
        <FieldDescription>Remy sends it to this computer and keeps it encrypted.</FieldDescription>
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy || !apiKey.trim()} onClick={() => void onSave(apiKey.trim())}>
          {busy && <Spinner data-icon="inline-start" />}
          Save key
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
