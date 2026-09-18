import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useHubResource } from "@/lib/hub-organization";
import { toast } from "sonner";

export interface ModelAccessEntry {id:string;enabled:boolean;configured:boolean;models:string[]}
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
    {resource.value && Object.entries(labels).map(([id,label])=><ModelAccessSection key={`${organizationId}:${id}`} label={label} value={entries.find(e=>e.id===id) ?? resource.value!.providers.find(e=>e.id===id) ?? {id,enabled:false,configured:false,models:[]}} available={!!resource.value} save={async patch=>{
      const result=await hubRequest<{providers:ModelAccessEntry[]}>(`${hubThreadBase(organizationId)}/model-access/${id}`,"PATCH",patch);
      setEntries(current=>current.map(entry=>entry.id===id ? result.providers.find(e=>e.id===id)! : entry));
      return result.providers.find(e=>e.id===id)!;
    }}/>)}
  </section>;
}
function ModelAccessSection({label,value,available,save}:{label:string;value:ModelAccessEntry;available:boolean;save:(patch:{enabled:boolean;apiKey?:string})=>Promise<ModelAccessEntry>}) {
  const [expanded,setExpanded]=useState(value.enabled),[key,setKey]=useState(""),[busy,setBusy]=useState(false);
  const timer=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const revision=useRef(0),queue=useRef(Promise.resolve()),mounted=useRef(true);
  const confirmed=useRef(value);
  useEffect(()=>{confirmed.current=value;if(!busy)setExpanded(value.enabled);},[value.enabled,value.configured]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);revision.current++;};},[]);
  const persist=(enabled:boolean,apiKey?:string)=>{
    clearTimeout(timer.current);
    const version=++revision.current;
    setBusy(true);
    queue.current=queue.current.then(async()=>{
      try {
        const next=await save({enabled,...(apiKey?{apiKey}:{})});
        confirmed.current=next;
        if(mounted.current && revision.current===version){setKey("");setExpanded(next.enabled);}
      }catch{
        if(mounted.current && revision.current===version){toast.error("Couldn't save model access",{description:"Your changes could not be saved. Try again."});setExpanded(enabled || confirmed.current.enabled);}
      }finally{if(mounted.current && revision.current===version)setBusy(false);}
    });
  };
  return <section aria-label={`${label} model access`} className="rounded-xl border p-4">
    <div className="flex items-center gap-3"><KeyRound className="size-4 text-muted-foreground"/><h3 className="flex-1 text-sm leading-snug font-medium">{label}</h3><Switch aria-label={label} checked={expanded} disabled={!available || busy && !expanded} onCheckedChange={enabled=>{
      clearTimeout(timer.current);setExpanded(enabled);setKey("");
      if(!enabled){revision.current++;if(confirmed.current.configured || busy)persist(false);}
      else if(confirmed.current.configured || busy)persist(true);
    }}/></div>
    {expanded && <div className="relative mt-4"><Input aria-label={`${label} API key`} type="password" autoComplete="off" placeholder={value.configured?"••••••••":"API key"} value={key} maxLength={8192} className="pr-9" onChange={event=>{
      const next=event.target.value;setKey(next);clearTimeout(timer.current);revision.current++;
      if(next.trim())timer.current=setTimeout(()=>persist(true,next.trim()),800);
    }} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();if(key.trim())persist(true,key.trim());}}}/>{busy && <Loader2 aria-label="Saving key" className="absolute right-3 top-2.5 size-4 animate-spin text-muted-foreground"/>}</div>}
  </section>;
}
