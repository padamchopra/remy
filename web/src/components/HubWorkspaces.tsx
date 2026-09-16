import { useEffect, useState } from "react";
import type { Organization } from "@remy/contract";
import { HubPersonalContext } from "@/lib/hub-scope";
import { watchHubResource } from "@/lib/hub-computers";
import { hubThreadBase } from "@/lib/hub-threads";
import type { HubWorkspace } from "@/lib/hub-organization";
import { HubAddWorkspace } from "./HubAddWorkspace";
import OrganizationSettings from "./HubOrganizationSettings";
import { EmptyState } from "./EmptyState";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

export default function HubWorkspaces({organizations, filter, onOpenWorkspace, onAdded}: {
  organizations:Organization[]; filter:string; onOpenWorkspace:(organizationId:string,workspaceId:string)=>void; onAdded:(organizationId:string)=>void;
}) {
  const visible = organizations.filter(o => filter === "all" || o.id === filter);
  const ids = visible.map(o => o.id).join(",");
  const [summary,setSummary] = useState<{key:string; counts:Map<string,number>}>({key:"",counts:new Map()});
  const [error,setError] = useState("");
  const [adding,setAdding] = useState(false);
  useEffect(() => {
    const counts = new Map<string,number>();
    setError(""); setSummary({key:ids,counts:new Map()});
    const stops = ids.split(",").filter(Boolean).map(id => watchHubResource<{workspaces:HubWorkspace[]}>(`${hubThreadBase(id)}/workspaces`, value => {
      if (value) counts.set(id,value.workspaces.length);
      setSummary({key:ids,counts:new Map(counts)});
    },setError,`${hubThreadBase(id)}/live`));
    return () => stops.forEach(stop=>stop());
  },[ids]);
  const loaded = summary.key === ids && summary.counts.size === visible.length;
  const count = summary.key === ids ? [...summary.counts.values()].reduce((a,b)=>a+b,0) : 0;
  const canAdd = visible.some(o=>o.role !== "member");
  return <section className="flex min-w-0 flex-col gap-4 p-6" aria-label="Workspaces">
    {canAdd && (!loaded || count > 0) && <Button className="self-start" onClick={()=>setAdding(true)}>Add workspace</Button>}
    {error && <p role="alert">{error}</p>}
    {!loaded && !error && <Spinner aria-label="Loading workspaces" />}
    {loaded && count === 0 && <EmptyState title={canAdd ? "Add your first workspace" : "No workspaces available"} description={canAdd ? "Choose a repository for your first thread." : undefined}>{canAdd && <Button onClick={()=>setAdding(true)}>Add a workspace</Button>}</EmptyState>}
    {visible.map(owner => <HubPersonalContext key={owner.id} value={owner.personal === true}><OrganizationSettings workspaceListOnly workspaceOwnerLabel={filter === "all" ? owner.personal ? "Personal" : owner.name : undefined} organizationId={owner.id} kind="workspaces" role={owner.role} onOpenWorkspace={id=>onOpenWorkspace(owner.id,id)} /></HubPersonalContext>)}
    <HubAddWorkspace organizationId={filter === "all" ? organizations.find(o=>o.personal)?.id ?? organizations[0]?.id ?? "" : filter} organizations={organizations} open={adding} onOpenChange={setAdding} onAdded={onAdded} />
  </section>;
}
