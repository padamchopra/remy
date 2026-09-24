import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { HubNamedKeys, type NamedKey } from "./HubNamedKeys";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useHubResource } from "@/lib/hub-organization";
import { toast } from "sonner";

export interface ModelAccessEntry {id:string;enabled:boolean;configured:boolean;models:string[];keys?:NamedKey[]}
const labels:Record<string,string>={anthropic:"Anthropic",openai:"OpenAI",router:"Router.com",openrouter:"OpenRouter"};
export function HubModelAccess({organizationId}:{organizationId:string}) {
  const resource=useHubResource<{providers:ModelAccessEntry[]}>(organizationId,"/model-access");
  const [entries,setEntries]=useState<ModelAccessEntry[]>([]);
  useEffect(()=>{if(resource.value)setEntries(resource.value.providers);},[resource.value]);
  return <section aria-label="Model access" className="space-y-4 border-t pt-6">
    <div className="space-y-1">
      <h2 className="text-sm font-medium">Model access</h2>
      {resource.error && <p role="alert" className="text-sm text-muted-foreground">{resource.error === "Not found" ? "Update your hosted service to configure model access." : resource.error}</p>}
    </div>
    {!resource.value && !resource.error && <div aria-label="Loading model access" role="status" className="space-y-4">{Object.keys(labels).map(id=><Skeleton key={id} className="h-[54px] w-full rounded-xl" />)}</div>}
    {resource.value && Object.entries(labels).map(([id,label])=><ModelAccessSection key={`${organizationId}:${id}`} label={label} value={entries.find(e=>e.id===id) ?? resource.value!.providers.find(e=>e.id===id) ?? {id,enabled:false,configured:false,models:[],keys:[]}} available={!!resource.value} save={async (patch, keyId, remove)=>{
      const path = keyId
        ? `${hubThreadBase(organizationId)}/model-access/${id}/keys/${encodeURIComponent(keyId)}`
        : patch.apiKey || patch.name
          ? `${hubThreadBase(organizationId)}/model-access/${id}/keys`
          : `${hubThreadBase(organizationId)}/model-access/${id}`;
      const result=await hubRequest<{providers:ModelAccessEntry[]}>(path, remove ? "DELETE" : keyId ? "PATCH" : patch.apiKey || patch.name ? "POST" : "PATCH", remove ? undefined : patch);
      setEntries(result.providers);
      return result.providers.find(e=>e.id===id)!;
    }}/>)}
  </section>;
}
function ModelAccessSection({label,value,available,save}:{label:string;value:ModelAccessEntry;available:boolean;save:(patch:{enabled?:boolean;apiKey?:string;name?:string;active?:boolean}, keyId?:string, remove?:boolean)=>Promise<ModelAccessEntry>}) {
  const [expanded,setExpanded]=useState(value.enabled),[busy,setBusy]=useState(false);
  useEffect(()=>{if(!busy)setExpanded(value.enabled);},[value.enabled,value.configured,busy]);
  const persist=async (patch:{enabled?:boolean;apiKey?:string;name?:string;active?:boolean}, keyId?:string, remove?:boolean)=>{
    setBusy(true);
    try { await save(patch, keyId, remove); }
    catch { toast.error("Couldn't save model access",{description:"Your changes could not be saved. Try again."}); setExpanded(value.enabled); }
    finally { setBusy(false); }
  };
  return <section aria-label={`${label} model access`} className="rounded-xl border p-4">
    <div className="flex items-center gap-3"><KeyRound className="size-4 text-muted-foreground"/><h3 className="flex-1 text-sm leading-snug font-medium">{label}</h3><Switch aria-label={label} checked={expanded} disabled={!available || busy && !expanded} onCheckedChange={enabled=>{
      setExpanded(enabled);
      if(!enabled) void persist({enabled:false});
      else if(value.configured) void persist({enabled:true});
    }}/></div>
    {expanded && <div className="mt-4">
      <HubNamedKeys
        label={label}
        keys={value.keys ?? []}
        fields={[{ id: "apiKey", label: "API key", name: `${label} API key` }]}
        busy={busy}
        onSave={(input) => persist({ name: input.name, apiKey: input.values.apiKey || undefined }, input.keyId)}
        onRemove={(keyId) => persist({}, keyId, true)}
        onActivate={ (value.keys?.length ?? 0) > 1 ? (keyId) => persist({ active: true }, keyId) : undefined }
      />
    </div>}
  </section>;
}
