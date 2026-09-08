const Routing = lazy(() => import("./HubRouting").then(m => ({default:m.HubRouting})));
import { lazy, useEffect, useState } from "react";
import {
  Folder,
  Laptop,
  MessagesSquare,
  Plus,
  SquareKanban,
  Users,
  User,
} from "lucide-react";
import type { HubThread, Organization } from "@remy/contract";
import type { HubRuntime } from "@/lib/hub-session";
import {
  hubRequest,
  HubRequestError,
  hubThreadBase,
  watchHubThreads,
} from "@/lib/hub-threads";
import { watchHubResource } from "@/lib/hub-computers";
import { parseLocation, formatLocation, type Route } from "@/lib/route";
import { apiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import { Deferred } from "@/components/Deferred";
import { HubSignIn } from "./HubSignIn";
const Threads = lazy(() => import("./HubThreads"));
const Board = lazy(() => import("./HubBoard"));
const Computers = lazy(() =>
  import("./HubComputers").then((m) => ({ default: m.HubComputers })),
);
const OrganizationSettings = lazy(() => import("./HubOrganizationSettings"));

export default function HubApp({ runtime }: { runtime: HubRuntime }) {
  const [route, setRoute] = useState<Route>(
    parseLocation(window.location.hash).route,
  );
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [profile, setProfile] = useState<{ id: string; name: string }>();
  const [loaded, setLoaded] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [threads, setThreads] = useState<HubThread[]>([]);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState(
    new URLSearchParams(window.location.search).get("invite") ?? (window.location.pathname.startsWith("/invite/") ? decodeURIComponent(window.location.pathname.slice(8)) : null),
  );
  const navigate = (next: Route) => {
    window.location.hash = formatLocation({ route: next });
  };
  const reload = async () => {
    try {
      const [result, person] = await Promise.all([
        hubRequest<{ organizations: Organization[] }>("/api/organizations"),
        hubRequest<{ id: string; name: string }>("/api/profile"),
      ]);
      setOrganizations(result.organizations);
      setProfile(person);
      setSignedOut(false);
    } catch (e) {
      if (e instanceof HubRequestError && e.status === 401) setSignedOut(true);
      else setError(apiError(e));
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    const changed = () => setRoute(parseLocation(window.location.hash).route);
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    void (async () => {
      if (
        new URLSearchParams(window.location.search).get("signin") === "complete"
      ) {
        try {
          await hubRequest("/api/sessions/web", "POST");
          const url = new URL(window.location.href);
          url.searchParams.delete("signin");
          window.history.replaceState(null, "", url);
        } catch (e) {
          setError(apiError(e));
        }
      }
      await reload();
    })();
  }, []);
  const organizationId =
    route.organizationId ??
    (profile
      ? localStorage.getItem(`remy.organization:${profile.id}`)
      : null) ??
    organizations[0]?.id;
  const organization = organizations.find((o) => o.id === organizationId);
  useEffect(() => {
    setThreads([]);
    if (!organization) return;
    localStorage.setItem(`remy.organization:${profile?.id}`, organization.id);
    if (!route.organizationId)
      navigate({ ...route, organizationId: organization.id });
    const offThreads = watchHubThreads(organization.id, setThreads, setError);
    const offOrganization = watchHubResource<{ organization: Organization }>(
      hubThreadBase(organization.id),
      (value) => {
        if (value)
          setOrganizations((all) =>
            all.map((o) =>
              o.id === value.organization.id ? value.organization : o,
            ),
          );
      },
      () => {
        void reload();
      },
    );
    return () => {
      offThreads();
      offOrganization();
    };
  }, [organization?.id, profile?.id]);
  if (!loaded)
    return (
      <p role="status" className="p-6">
        Opening your organization…
      </p>
    );
  if (signedOut) return <HubSignIn runtime={runtime} />;
  const section =
    route.name === "board" || route.name === "ticket"
      ? "tasks"
      : route.name === "settings"
        ? route.tab
        : route.name;
  const links: {
    label: string;
    icon: typeof Users;
    route: Route;
    selected: boolean;
  }[] = organization
    ? [
        {
          label: "Threads",
          icon: MessagesSquare,
          route: { name: "threads", organizationId },
          selected: section === "threads",
        },
        {
          label: "Tasks",
          icon: SquareKanban,
          route: { name: "board", organizationId },
          selected: section === "tasks",
        },
        {
          label: "Workspaces",
          icon: Folder,
          route: { name: "workspaces", organizationId },
          selected: section === "workspaces",
        },
        {
          label: "Computers",
          icon: Laptop,
          route: { name: "settings", tab: "devices", organizationId },
          selected: section === "devices",
        },
        {
          label: "Routing", icon: Laptop, route: {name:"settings",tab:"routing",organizationId}, selected:section==="routing",
        },
        {
          label: "Members",
          icon: User,
          route: { name: "settings", tab: "members", organizationId },
          selected: section === "members",
        },
        {
          label: "Teams",
          icon: Users,
          route: { name: "settings", tab: "teams", organizationId },
          selected: section === "teams",
        },
      ]
    : [];
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Select
            value={organization?.id ?? ""}
            onValueChange={(id) => {
              setError("");
              navigate({ name: "threads", organizationId: id });
            }}
          >
            <SelectTrigger aria-label="Organization">
              <SelectValue placeholder="Choose an organization" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {organizations.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setCreate(true)}>
            <Plus data-icon="inline-start" />
            Create organization
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="shrink-0">
            <SidebarGroupContent>
              <SidebarMenu>
                {links.map((link) => (
                  <SidebarMenuItem key={link.label}>
                    <SidebarMenuButton
                      isActive={link.selected}
                      data-link
                      onClick={() => navigate(link.route)}
                    >
                      <link.icon />
                      <span>{link.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="shrink-0">
            <SidebarGroupLabel>Threads</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {threads.map((thread) => (
                  <SidebarMenuItem key={`${thread.computerId}:${thread.id}`}>
                    <SidebarMenuButton
                      data-link
                      isActive={
                        route.name === "threads" &&
                        route.threadId === thread.id &&
                        route.computerId === thread.computerId
                      }
                      onClick={() =>
                        navigate({
                          name: "threads",
                          organizationId,
                          computerId: thread.computerId,
                          threadId: thread.id,
                        })
                      }
                    >
                      <MessagesSquare />
                      <span>{thread.detail.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <span className="truncate">{profile?.name}</span>
          <Button
            variant="ghost"
            onClick={() =>
              void hubRequest("/api/sessions/current", "DELETE")
                .then(() => {
                  setOrganizations([]);
                  setThreads([]);
                  setSignedOut(true);
                })
                .catch((e) => setError(apiError(e)))
            }
          >
            Sign out
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-b p-3">
          <SidebarTrigger />
          <span>{organization?.name ?? "Remy"}</span>
        </header>
        {error && (
          <p role="alert" className="px-4 py-2">
            {error}
          </p>
        )}
        {!organization ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {organizations.length
                  ? "Choose an organization"
                  : "Create your organization"}
              </EmptyTitle>
              <EmptyDescription>
                {organizations.length
                  ? "Choose an organization you belong to from the sidebar."
                  : "Invite your teammates and share your Tasks."}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setCreate(true)}>
                Create organization
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div key={organization.id} className="flex min-h-0 flex-1 flex-col">
            <div
              hidden={section !== "threads"}
              className={
                section === "threads" ? "flex min-h-0 flex-1" : undefined
              }
            >
              <Deferred open={section === "threads"}>
                <Threads
                  organizationId={organization.id}
                  computerId={
                    route.name === "threads" ? route.computerId : undefined
                  }
                  threadId={
                    route.name === "threads" ? route.threadId : undefined
                  }
                  navigate={navigate}
                />
              </Deferred>
            </div>
            <div
              hidden={section !== "tasks"}
              className={
                section === "tasks" ? "flex min-h-0 flex-1" : undefined
              }
            >
              <Deferred open={section === "tasks"}>
                <Board
                  organizationId={organization.id}
                  ticketId={route.name === "ticket" ? route.key : undefined}
                  navigate={navigate}
                />
              </Deferred>
            </div>
            <div
              hidden={section !== "devices"}
              className="min-h-0 overflow-auto p-6"
            >
              <Deferred open={section === "devices"}>
                <Computers organizationId={organization.id} />
              </Deferred>
            </div>
            <div hidden={section!=="routing"} className="min-h-0 overflow-auto"><Deferred open={section==="routing"}><Routing organizationId={organization.id}/></Deferred></div>
            {(["members", "teams", "workspaces"] as const).map((kind) => (
              <div
                hidden={section !== kind}
                key={kind}
                className="min-h-0 overflow-auto"
              >
                <Deferred open={section === kind}>
                  <OrganizationSettings
                    organizationId={organization.id}
                    kind={kind}
                    role={organization.role}
                  />
                </Deferred>
              </div>
            ))}
          </div>
        )}
      </SidebarInset>
      <Dialog open={create} onOpenChange={setCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Choose a name your teammates recognize.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void hubRequest<Organization>("/api/organizations", "POST", {
                name,
              })
                .then(async (o) => {
                  await reload();
                  navigate({ name: "board", organizationId: o.id });
                  setCreate(false);
                  setName("");
                })
                .catch((e) => setError(apiError(e)))
                .finally(() => setBusy(false));
            }}
          >
            <Field>
              <FieldLabel htmlFor="organization-name">Name</FieldLabel>
              <Input
                id="organization-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </Field>
            {error && <p role="alert">{error}</p>}
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreate(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !name.trim()}>
                Create organization
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!invite}
        onOpenChange={(v) => {
          if (!v) setInvite(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join your organization</DialogTitle>
            <DialogDescription>
              Accept your invitation to share work with your teammates.
            </DialogDescription>
          </DialogHeader>
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void hubRequest<{ organizationId: string }>(
                  "/api/invitations/accept",
                  "POST",
                  { token: invite },
                )
                  .then(async (result) => {
                    setInvite(null);
                    window.history.replaceState(null, "", "/");
                    await reload();
                    navigate({
                      name: "board",
                      organizationId: result.organizationId,
                    });
                  })
                  .catch((e) => setError(apiError(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Accept invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
