import { lazy } from "react";
import type { HubThread, Organization } from "@remy/contract";
import type { Route } from "@/lib/route";
import { HubPersonalContext } from "@/lib/hub-scope";
import { HubModelFavorites } from "./HubModelFavorites";
import { HubThreadSidebar } from "./HubThreadSidebar";
import { Deferred } from "./Deferred";
import { Button } from "./ui/button";
import { SidebarMenu } from "./ui/sidebar";
import { Spinner } from "./ui/spinner";
import { EmptyState } from "./EmptyState";

const Threads = lazy(() => import("./HubThreads"));
const Board = lazy(() => import("./HubBoard"));
const Inbox = lazy(() => import("./HubInbox").then(m => ({default:m.HubInbox})));
const Workspaces = lazy(() => import("./HubOrganizationSettings"));
const Workspace = lazy(() => import("./HubWorkspaceDetails"));
const Computers = lazy(() => import("./HubComputers").then(m => ({default:m.HubComputers})));
const General = lazy(() => import("./HubGeneralSettings"));
const Connections = lazy(() => import("./HubConnections").then(m => ({default:m.HubConnections})));
const Routing = lazy(() => import("./HubRouting").then(m => ({default:m.HubRouting})));
const Environments = lazy(() => import("./EnvironmentsSettings").then(m => ({default:m.EnvironmentsSettings})));

export default function HubAllView({organizations, threads, threadsLoaded, route, userId, navigate}: {
  organizations: Organization[]; threads: HubThread[]; threadsLoaded:boolean; route: Route; userId: string; navigate: (route: Route) => void;
}) {
  const scoped = (next: Route) => navigate({...next, organizationId:"all", ownerOrganizationId:next.organizationId});
  const owners = route.ownerOrganizationId ? organizations.filter(o => o.id === route.ownerOrganizationId) : organizations;
  if (!owners.length) return <EmptyState title="This account is unavailable" />;
  return <div className="flex min-h-0 flex-1 flex-col overflow-auto">
    {route.ownerOrganizationId && <div className="px-5 pt-3"><Button variant="ghost" data-link onClick={() => navigate({name:route.name === "ticket" ? "board" : route.name === "settings" ? "threads" : route.name, organizationId:"all"} as Route)}>Back to all</Button></div>}
    {owners.map(organization => {
      const id = organization.id;
      const ownThreads = threads.filter(t => t.access.organizationId === id);
      const section = route.name === "settings" ? route.tab : route.name;
      if (organization.personal && (section === "members" || section === "teams")) return null;
      const openThread = (thread: HubThread) => scoped({name:"threads", organizationId:id, computerId:thread.computerId, threadId:thread.id});
      return <HubPersonalContext key={id} value={organization.personal === true}><HubModelFavorites organizationId={id}>
        <section className={route.ownerOrganizationId && route.name === "threads" ? "flex min-h-0 flex-1 flex-col" : "shrink-0 border-b last:border-b-0"} aria-label={organization.name}>
          <div className="flex items-center justify-between gap-3 px-5 py-3"><h2 className="text-sm font-medium">{organization.name}</h2>{section === "threads" && !route.ownerOrganizationId && <Button variant="outline" size="sm" data-link onClick={() => scoped({name:"threads",organizationId:id})}>New thread</Button>}</div>
          <Deferred open>
            {section === "threads" && (route.ownerOrganizationId ? <Threads organizationId={id} showNavigation={false} canManageWorkspaces={organization.role !== "member"} computerId={route.name === "threads" ? route.computerId : undefined} threadId={route.name === "threads" ? route.threadId : undefined} navigate={scoped} /> : !threadsLoaded ? <div className="px-5 pb-4"><Spinner aria-label="Loading threads" /></div> : ownThreads.length ? <SidebarMenu className="px-5 pb-4"><HubThreadSidebar organizationId={id} threads={ownThreads} onSelect={openThread} /></SidebarMenu> : <p className="px-5 pb-4 text-sm text-muted-foreground">No threads yet</p>)}
            {(section === "board" || section === "ticket") && <Board organizationId={id} ticketId={route.name === "ticket" ? route.key : undefined} navigate={scoped} />}
            {section === "inbox" && <Inbox organizationId={id} userId={userId} agentId={route.name === "inbox" ? route.agent : undefined} choose={agent => scoped({name:"inbox",organizationId:id,agent})} />}
            {section === "workspaces" && (route.name === "workspaces" && route.workspaceId ? <Workspace organizationId={id} workspaceId={route.workspaceId} role={organization.role} onBack={() => navigate({name:"workspaces",organizationId:"all"})} /> : <Workspaces organizationId={id} kind="workspaces" role={organization.role} onOpenWorkspace={workspaceId => scoped({name:"workspaces",organizationId:id,workspaceId})} />)}
            {section === "general" && <General organizationId={id} />}
            {section === "devices" && <div className="p-5"><Computers organizationId={id} /></div>}
            {section === "environments" && <div className="p-5"><Environments organizationId={id} /></div>}
            {section === "connections" && <Connections organizationId={id} />}
            {section === "routing" && <Routing organizationId={id} />}
            {(section === "members" || section === "teams") && <Workspaces organizationId={id} kind={section} role={organization.role} onOpenWorkspace={workspaceId => scoped({name:"workspaces",organizationId:id,workspaceId})} />}
          </Deferred>
        </section>
      </HubModelFavorites></HubPersonalContext>;
    })}
  </div>;
}
