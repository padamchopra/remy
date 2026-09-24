import { useEffect, useState } from "react";
import type { Organization } from "@remy/contract";
import { HubPersonalContext } from "@/lib/hub-scope";
import { watchHubResource } from "@/lib/hub-computers";
import { hubThreadBase } from "@/lib/hub-threads";
import type { HubWorkspace } from "@/lib/hub-organization";
import {
  cacheHubWorkspaces,
  cachedHubWorkspaces,
  hasCachedHubWorkspaces,
  hasCachedHubWorkspacesFor,
} from "@/lib/hub-workspace-cache";
import { HubAddWorkspace } from "./HubAddWorkspace";
import OrganizationSettings from "./HubOrganizationSettings";
import { EmptyState } from "./EmptyState";
import { WorkspaceListSkeleton } from "./WorkspaceListSkeleton";
import { Button } from "./ui/button";

function countsFromCache(ids: string) {
  const counts = new Map<string, number>();
  for (const id of ids.split(",").filter(Boolean)) {
    if (hasCachedHubWorkspaces(id)) counts.set(id, cachedHubWorkspaces(id).length);
  }
  return counts;
}

export default function HubWorkspaces({organizations, filter, onOpenWorkspace, onAdded}: {
  organizations:Organization[]; filter:string; onOpenWorkspace:(organizationId:string,workspaceId:string)=>void; onAdded:(organizationId:string)=>void;
}) {
  const visible = organizations.filter(o => filter === "all" || o.id === filter);
  const ids = visible.map(o => o.id).join(",");
  const [summary,setSummary] = useState<{key:string; counts:Map<string,number>; live:Set<string>}>(() => ({
    key: ids,
    counts: countsFromCache(ids),
    live: new Set(),
  }));
  const [error,setError] = useState("");
  const [adding,setAdding] = useState(false);
  useEffect(() => {
    const counts = countsFromCache(ids);
    const live = new Set<string>();
    setError("");
    setSummary({key:ids,counts:new Map(counts),live:new Set()});
    const stops = ids.split(",").filter(Boolean).map(id => watchHubResource<{workspaces:HubWorkspace[]}>(`${hubThreadBase(id)}/workspaces`, value => {
      if (value) {
        cacheHubWorkspaces(id, value.workspaces);
        counts.set(id, value.workspaces.length);
        live.add(id);
      }
      setSummary({key:ids,counts:new Map(counts),live:new Set(live)});
    },setError,`${hubThreadBase(id)}/live`));
    return () => stops.forEach(stop=>stop());
  },[ids]);
  const loaded = summary.key === ids && visible.every(owner => summary.live.has(owner.id));
  const tileCount = (owner: Organization) =>
    summary.key === ids && summary.counts.has(owner.id)
      ? summary.counts.get(owner.id) ?? 0
      : cachedHubWorkspaces(owner.id).length;
  const count = visible.reduce((total, owner) => total + tileCount(owner), 0);
  const cached = hasCachedHubWorkspacesFor(visible.map(owner => owner.id));
  const waiting = !loaded && !cached && !error;
  const canAdd = visible.some(o=>o.role !== "member");
  const ownersWithTiles = visible.filter((owner) => tileCount(owner) > 0);
  return <section className="flex min-w-0 flex-col gap-4 p-6" aria-label="Workspaces">
    {canAdd && (waiting || count > 0) && <Button className="mb-2 self-end" onClick={()=>setAdding(true)}>Add workspace</Button>}
    {error && <p role="alert">{error}</p>}
    {waiting && <WorkspaceListSkeleton />}
    {!waiting && count === 0 && <EmptyState title={canAdd ? "Add your first workspace" : "No workspaces available"} description={canAdd ? "Choose a repository for your first thread." : undefined}>{canAdd && <Button onClick={()=>setAdding(true)}>Add a workspace</Button>}</EmptyState>}
    {ownersWithTiles.map(owner => <HubPersonalContext key={owner.id} value={owner.personal === true}><OrganizationSettings workspaceListOnly workspaceOwnerLabel={filter === "all" ? owner.personal ? "Personal" : owner.name : undefined} organizationId={owner.id} kind="workspaces" role={owner.role} onOpenWorkspace={id=>onOpenWorkspace(owner.id,id)} /></HubPersonalContext>)}
    <HubAddWorkspace organizationId={filter === "all" ? organizations.find(o=>o.personal)?.id ?? organizations[0]?.id ?? "" : filter} organizations={organizations} open={adding} onOpenChange={setAdding} onAdded={onAdded} />
  </section>;
}
