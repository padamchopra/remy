import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessMark } from "./AccessMark";
import { SettingsList, SettingsRow, SettingsSection } from "./SettingsList";
import { Switch } from "./ui/switch-base";
import { Skeleton } from "./ui/skeleton";
import { useHubResource } from "@/lib/hub-organization";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import type { OwnModelAccessEntry, OwnModelAccessResponse } from "@/lib/hub-models";
import { apiError } from "@/lib/api-error";

const LABELS: Record<OwnModelAccessEntry["id"], string> = { chatgpt: "ChatGPT", anthropic: "Anthropic", openai: "OpenAI", router: "Router.com", openrouter: "OpenRouter" };
const MARKS: Record<OwnModelAccessEntry["id"], string> = { chatgpt: "codex", anthropic: "anthropic", openai: "openai", router: "router", openrouter: "openrouter" };

/// Your own model access in one organization. Your API keys are off until you
/// turn them on; ChatGPT keeps its earlier default. On means only the threads
/// you start there may use it.
export function HubOwnModelAccess({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const resource = useHubResource<OwnModelAccessResponse>(organizationId, "/own-model-access", "/computers/live");
  const [value, setValue] = useState<OwnModelAccessResponse>();
  const [busy, setBusy] = useState("");
  useEffect(() => { if (resource.value) setValue(resource.value); }, [resource.value]);
  const current = value ?? resource.value;
  if (current?.personal) return null;
  const toggle = async (entry: OwnModelAccessEntry, allowed: boolean) => {
    setBusy(entry.id);
    setValue(previous => previous && { ...previous, providers: previous.providers.map(item => item.id === entry.id ? { ...item, allowed } : item) });
    try { setValue(await hubRequest<OwnModelAccessResponse>(`${hubThreadBase(organizationId)}/own-model-access/${entry.id}`, allowed ? "PUT" : "DELETE")); }
    catch (cause) { setValue(resource.value); toast.error(`Couldn't change ${LABELS[entry.id]}`, { description: apiError(cause) }); }
    finally { setBusy(""); }
  };
  return <SettingsSection id={`own-model-access-${organizationId}`} title="Your model access" description={`Your API keys are off here until you turn them on. Only threads you start in ${organizationName} use them; nobody else sees them.`}>
    {resource.error && <p role="alert" className="text-[13px] text-muted-foreground">{resource.error === "Not found" ? "Update your hosted service to use your own keys here." : resource.error}</p>}
    {!current && !resource.error && <Skeleton className="h-[160px] w-full rounded-[10px]" aria-label="Loading your model access" />}
    {current && <SettingsList label="Your model access">
      {current.providers.map(entry => <SettingsRow
        key={entry.id}
        media={<AccessMark id={MARKS[entry.id]} />}
        title={LABELS[entry.id]}
        description={!entry.configured ? (entry.id === "chatgpt" ? "Sign in to ChatGPT in Personal model access first" : "Add a key in Personal model access first") : entry.id === "chatgpt" ? "Your plan · Codex" : `Your key${entry.keyName ? ` · ${entry.keyName}` : ""}`}
      >
        <Switch aria-label={`Use my ${LABELS[entry.id]} in ${organizationName}`} checked={entry.configured && entry.allowed} disabled={!entry.configured || !!busy} onCheckedChange={allowed => void toggle(entry, allowed)} />
      </SettingsRow>)}
    </SettingsList>}
  </SettingsSection>;
}
