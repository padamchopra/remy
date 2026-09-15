import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
export function HubRouterConnection({organizationId, configured, changed}: {organizationId:string;configured:boolean;changed:()=>Promise<void>}) {
  const [editing,setEditing]=useState(false),[key,setKey]=useState(""),[model,setModel]=useState("");
  const [models,setModels]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const base=hubThreadBase(organizationId);
  const close=()=>{setEditing(false);setKey("");setModel("");setModels([]);setError("");};
  return <div className="py-3">
    <div className="flex items-center gap-3"><KeyRound className="size-4 text-muted-foreground"/><span className="flex-1 text-sm">Router.com</span><span className="text-xs text-muted-foreground">{configured ? "Configured" : "Not configured"}</span><Button variant="outline" size="sm" onClick={()=>editing?close():setEditing(true)}>{configured ? "Manage" : "Configure"}</Button></div>
    {editing && <form aria-label="Router connection" className="mt-4 flex flex-col gap-3 rounded-lg bg-muted/30 p-4" onSubmit={async e=>{
      e.preventDefault();setBusy(true);setError("");
      try {
        if(!models.length){const result=await hubRequest<{models:string[]}>(`${base}/router-models`,"POST",{apiKey:key});setModels(result.models);if(!result.models.length)setError("No models are available to this key.");}
        else {await hubRequest(`${base}/router-connection`,"PUT",{apiKey:key,model});await changed();close();}
      } catch(e){setError(e instanceof Error?e.message:"Router could not connect.");} finally {setBusy(false);}
    }}>
      <Field><FieldLabel htmlFor="router-key">Router API key</FieldLabel><Input id="router-key" type="password" autoComplete="off" value={key} disabled={busy} onChange={e=>{setKey(e.target.value);setModels([]);setModel("");}} required/><FieldDescription>Use Router for new cloud threads through Codex.</FieldDescription></Field>
      {!!models.length && <Field><FieldLabel>Model</FieldLabel><Select value={model} onValueChange={setModel}><SelectTrigger aria-label="Router model"><SelectValue placeholder="Choose a model"/></SelectTrigger><SelectContent>{models.map(id=><SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent></Select></Field>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy||!key.trim()||!!models.length&&!model}>{busy?"Connecting…":models.length?"Save connection":"Load models"}</Button><Button type="button" variant="ghost" onClick={close}>Cancel</Button>{configured&&<Button type="button" variant="outline" disabled={busy} onClick={async()=>{setBusy(true);try{await hubRequest(`${base}/router-connection`,"DELETE");await changed();close();}catch{setError("Router could not disconnect. Try again.");}finally{setBusy(false);}}}>Disconnect</Button>}</div>
      {error&&<p role="alert">{error}</p>}
    </form>}
  </div>;
}
