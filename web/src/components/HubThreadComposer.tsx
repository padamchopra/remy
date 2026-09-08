import { useEffect, useState } from "react";
import type { ComputerSummary } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deviceIcon, type DeviceIconId } from "@/lib/devices";
import { hubRequest, hubThreadPath, hubThreadBase } from "@/lib/hub-threads";

export function HubThreadComposer({ organizationId, computers, open }: { organizationId: string; computers: ComputerSummary[]; open: (computer: string, thread: string) => void }) {
  const [selected, select] = useState("");
  const [workspaceId, setWorkspace] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const eligible = computers.filter((c) => c.canUse && c.availability !== "offline" && !c.updateRequired && c.capabilities.workspaces.length);
  const computer = eligible.find((c) => c.computerId === selected) ?? (!selected ? eligible[0] : undefined);
  const workspace = computer?.capabilities.workspaces.find((w) => w.id === workspaceId) ?? (!workspaceId ? computer?.capabilities.workspaces[0] : undefined);
  useEffect(() => {
    if (!title.trim() || computer?.ownership !== "hosted" || !workspace?.origin) return;
    const timer=setTimeout(()=>{void hubRequest<{workspaces:{id:string;origin:string}[]}>(`${hubThreadBase(organizationId)}/workspaces`).then(async ({workspaces})=>{const target=workspaces.find(w=>w.origin===workspace.origin);if(target)await hubRequest(`${hubThreadBase(organizationId)}/hosted/${target.id}/prewarm`,"POST");}).catch(()=>undefined);},300);
    return()=>clearTimeout(timer);
  },[title,computer?.ownership,workspace?.origin,organizationId]);
  if (!eligible.length) return null;
  return <form className="flex w-full max-w-xl flex-col gap-3 rounded-lg border p-4" aria-label="New thread" onSubmit={async (event) => {
    event.preventDefault(); if (!computer || !workspace || busy) return;
    setBusy(true); setError("");
    try { const thread = await hubRequest<{ id: string }>(hubThreadPath(organizationId, computer.computerId), "POST", { workspaceId: workspace.id, ...(title.trim() ? { title: title.trim() } : {}) }); open(computer.computerId, thread.id); }
    catch (e) { setError(e instanceof Error ? e.message : "This thread could not start."); }
    finally { setBusy(false); }
  }}>
    <Field><FieldLabel htmlFor="hub-thread-title">Thread name</FieldLabel><Input id="hub-thread-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What are you working on?" maxLength={200} disabled={busy} /></Field>
    <Field><FieldLabel>Computer</FieldLabel><Select value={computer?.computerId ?? ""} disabled={busy} onValueChange={(id) => { select(id); setWorkspace(""); }}><SelectTrigger aria-label="Thread computer"><SelectValue placeholder="Choose a computer" /></SelectTrigger><SelectContent><SelectGroup>{eligible.map((c) => { const Icon = deviceIcon(c.icon as DeviceIconId); return <SelectItem key={c.computerId} value={c.computerId}><Icon />{c.name}</SelectItem>; })}</SelectGroup></SelectContent></Select></Field>
    <Field><FieldLabel>Workspace</FieldLabel><Select value={workspace?.id ?? ""} disabled={busy || !computer} onValueChange={setWorkspace}><SelectTrigger aria-label="Thread workspace"><SelectValue placeholder="Choose a workspace" /></SelectTrigger><SelectContent><SelectGroup>{computer?.capabilities.workspaces.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
    {selected && !computer && <p role="status">Choose another computer to continue.</p>}
    {error && <p role="alert">{error}</p>}
    <Button type="submit" disabled={busy || !computer || !workspace}>Start thread</Button>
  </form>;
}
