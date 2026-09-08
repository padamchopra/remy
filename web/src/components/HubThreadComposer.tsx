import { useEffect, useState } from "react";
import type { ComputerSummary } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hubRequest, hubThreadPath, hubThreadBase } from "@/lib/hub-threads";
export function HubThreadComposer({organizationId,computers,open}:{organizationId:string;computers:ComputerSummary[];open:(computer:string,thread:string)=>void}) {
 const base=hubThreadBase(organizationId),[workspaces,setWorkspaces]=useState<{id:string;name:string;origin:string}[]>([]),[workspaceId,setWorkspace]=useState(""),[selected,select]=useState("automatic"),[title,setTitle]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 useEffect(()=>{void hubRequest<{workspaces:typeof workspaces}>(`${base}/workspaces`).then(r=>{setWorkspaces(r.workspaces);setWorkspace(r.workspaces[0]?.id??"");}).catch(e=>setError(e.message));},[base]);
 const workspace=workspaces.find(w=>w.id===workspaceId);
 const eligible=computers.filter(c=>c.canUse && c.availability!=="offline" && !c.updateRequired && c.capabilities.workspaces.some(w=>w.id===workspaceId || w.origin===workspace?.origin));
 useEffect(()=>{if(!title.trim() || !workspaceId)return;const timer=setTimeout(()=>{void hubRequest(`${base}/routing/resolve`,"POST",{workspaceId,trigger:"manual",usePreference:true,prewarm:true}).catch(()=>undefined);},300);return()=>clearTimeout(timer);},[title,workspaceId,base]);
 return <form className="flex w-full max-w-xl flex-col gap-3 rounded-lg border p-4" aria-label="New thread" onSubmit={async event=>{
 event.preventDefault();if(!workspace || busy)return;setBusy(true);setError("");
 try {
  let choice:{computerId?:string;workspaceId?:string;reason?:string}={};
  if(selected!=="automatic") {const c=eligible.find(c=>c.computerId===selected);if(!c)throw Error("Choose another computer to continue.");choice={computerId:c.computerId,workspaceId:c.capabilities.workspaces.find(w=>w.id===workspaceId || w.origin===workspace.origin)!.id};}
  else {for(let attempt=0;attempt<60;attempt++){choice=await hubRequest(`${base}/routing/resolve`,"POST",{workspaceId,trigger:"manual",usePreference:true,prewarm:attempt===0});if(choice.computerId)break;if(attempt===59)throw Error(choice.reason??"This computer could not start.");await new Promise(r=>setTimeout(r,1000));}}
  if(!choice.computerId || !choice.workspaceId)throw Error(choice.reason??"Choose another computer.");
  const thread=await hubRequest<{id:string}>(hubThreadPath(organizationId,choice.computerId),"POST",{workspaceId:choice.workspaceId,...(title.trim()?{title:title.trim()}:{})});open(choice.computerId,thread.id);
 }catch(e){setError(e instanceof Error?e.message:"This thread could not start.");}finally{setBusy(false);}
 }}><Field><FieldLabel htmlFor="hub-thread-title">Thread name</FieldLabel><Input id="hub-thread-title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="What are you working on?" maxLength={200} disabled={busy}/></Field><Field><FieldLabel>Workspace</FieldLabel><Select value={workspaceId} disabled={busy} onValueChange={v=>{if(!v)return;setWorkspace(v);select("automatic");}}><SelectTrigger aria-label="Thread workspace"><SelectValue placeholder="Choose a workspace"/></SelectTrigger><SelectContent>{workspaces.map(w=><SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent></Select></Field><Field><FieldLabel>Computer</FieldLabel><Select value={selected} disabled={busy} onValueChange={v=>{if(!v)return;select(v);void hubRequest(`${base}/routing/preference`,"POST",{workspaceId,computerId:v==="automatic"?null:v}).catch(e=>setError(e.message));}}><SelectTrigger aria-label="Thread computer"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="automatic">Use routing rules</SelectItem>{eligible.map(c=><SelectItem key={c.computerId} value={c.computerId}>{c.name}</SelectItem>)}</SelectContent></Select></Field><p className="text-muted-foreground text-sm">Your computer choice is remembered for this workspace.</p>{busy&&<p role="status">Preparing your thread…</p>}{error&&<p role="alert">{error}</p>}<Button type="submit" disabled={busy || !workspace}>Start thread</Button></form>;
}
