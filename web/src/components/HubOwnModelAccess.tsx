import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessMark } from "./AccessMark";
import { SettingsList, SettingsRow, SettingsSection } from "./SettingsList";
import { ToggleChip } from "./ui/toggle-chip-base";
import { Skeleton } from "./ui/skeleton";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import type { OwnModelAccessEntry, OwnModelAccessResponse } from "@/lib/hub-models";
import { apiError } from "@/lib/api-error";

const LABELS: Record<OwnModelAccessEntry["id"], string> = { chatgpt: "ChatGPT", anthropic: "Anthropic", openai: "OpenAI", router: "Router.com", openrouter: "OpenRouter" };
const MARKS: Record<OwnModelAccessEntry["id"], string> = { chatgpt: "codex", anthropic: "anthropic", openai: "openai", router: "router", openrouter: "openrouter" };

/// A member's exact Personal keys enrolled for everyone in one organization.
/// Their own threads can use every Personal key without an enrollment.
export function HubOwnModelAccess({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const resource = useHubResource<OwnModelAccessResponse>(organizationId, "/own-model-access", "/computers/live");
  const [value, setValue] = useState<OwnModelAccessResponse>();
  const [busy, setBusy] = useState("");
  useEffect(() => { if (resource.value) setValue(resource.value); }, [resource.value]);
  const current = value ?? resource.value;
  if (current?.personal) return null;
  const select = async (entry: OwnModelAccessEntry, keyId: string, enrolled: boolean) => {
    const keyIds = entry.keys.filter((key) => key.id === keyId ? enrolled : key.enrolled).map((key) => key.id);
    setBusy(`${entry.id}:${keyId}`);
    setValue((previous) => previous && { ...previous, providers: previous.providers.map((provider) => provider.id === entry.id ? { ...provider, keys: provider.keys.map((key) => key.id === keyId ? { ...key, enrolled } : key) } : provider) });
    try {
      setValue(await hubRequest<OwnModelAccessResponse>(`${hubThreadBase(organizationId)}/own-model-access/${entry.id}`, keyIds.length ? "PUT" : "DELETE", keyIds.length ? { keyIds } : undefined));
    } catch (cause) {
      setValue(resource.value);
      toast.error(`Couldn't change ${LABELS[entry.id]}`, { description: apiError(cause) });
    } finally { setBusy(""); }
  };
  return <SettingsSection id={`own-model-access-${organizationId}`} title="Model access" description={`Your keys already work for threads you start. Enroll a key to let everyone in ${organizationName} use it.`}>
    {resource.error && <p role="alert" className="text-[13px] text-muted-foreground">{resource.error === "Not found" ? "Update your hosted service to enroll model access." : resource.error}</p>}
    {!current && !resource.error && <Skeleton className="h-[160px] w-full rounded-[10px]" aria-label="Loading model access" />}
    {current && <SettingsList label="Model access">
      {current.providers.map((entry) => <SettingsRow
        key={entry.id}
        media={<AccessMark id={MARKS[entry.id]} />}
        title={LABELS[entry.id]}
        description={!entry.configured ? (entry.id === "chatgpt" ? "Sign in to ChatGPT in Model access first" : "Add a key in Model access first") : entry.id === "chatgpt" ? "Your subscription stays personal" : entry.keys.some((key) => key.enrolled) ? "Available to everyone" : "Available only to you"}
        below={entry.keys.length > 0 && <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="mr-1 text-xs text-muted-foreground">Enroll keys</span>
          {entry.keys.map((key) => <ToggleChip key={key.id} pressed={key.enrolled} disabled={!!busy} aria-label={`Enroll ${LABELS[entry.id]} key ${key.name} in ${organizationName}`} onPressedChange={(enrolled) => void select(entry, key.id, enrolled)}>{key.name}</ToggleChip>)}
        </div>}
      />)}
    </SettingsList>}
  </SettingsSection>;
}
