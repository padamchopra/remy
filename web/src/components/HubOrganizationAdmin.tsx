import type { Organization } from "@remy/contract";
import { HubPersonalContext } from "@/lib/hub-scope";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { EmptyState } from "./EmptyState";
import OrganizationSettings from "./HubOrganizationSettings";
import { HubOrganizationComputers } from "./HubOrganizationComputers";
import { HubModelFavorites } from "./HubModelFavorites";

type OrganizationTab = "general" | "members" | "teams" | "computers";

export default function HubOrganizationAdmin({organizations, selectedId, tab, onSelect, onTab}: {
  organizations:Organization[]; selectedId?:string; tab:OrganizationTab;
  onSelect:(id:string)=>void; onTab:(tab:OrganizationTab)=>void;
}) {
  const organization = organizations.find(o=>o.id===selectedId) ?? organizations[0];
  // An organization has no General settings of its own; an older link to it opens Members.
  const current = tab === "general" ? "members" : tab;
  if (!organization) return <EmptyState title="No organizations yet" description="Create an organization from the account menu." />;
  return <HubPersonalContext value={false}>
    <HubModelFavorites organizationId={organization.id}>
    <section className="flex min-h-0 flex-1 flex-col overflow-auto" aria-label="Organization settings">
      <div className="px-6 pt-6"><Select value={organization.id} onValueChange={onSelect}><SelectTrigger aria-label="Organization" className="w-full sm:w-64"><SelectValue /></SelectTrigger><SelectContent>{organizations.map(o=><SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent></Select></div>
      <Tabs className="mt-4 min-h-0" value={current} onValueChange={value=>onTab(value as OrganizationTab)}>
        <TabsList className="mx-6"><TabsTrigger value="members">Members</TabsTrigger><TabsTrigger value="teams">Teams</TabsTrigger><TabsTrigger value="computers">Computers</TabsTrigger></TabsList>
        {(["members","teams"] as const).map(kind=><TabsContent key={kind} value={kind}><OrganizationSettings key={`${organization.id}:${kind}`} organizationId={organization.id} kind={kind} role={organization.role} /></TabsContent>)}
        <TabsContent value="computers"><HubOrganizationComputers key={organization.id} organizationId={organization.id} /></TabsContent>
      </Tabs>
    </section>
    </HubModelFavorites>
  </HubPersonalContext>;
}
