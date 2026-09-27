import { lazy, Suspense, useEffect, useState } from "react";
import type {
  HubThread,
  Organization,
} from "@remy/contract";
import type { Route } from "@/lib/route";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useThreadStarts } from "@/lib/hub-thread-start";
import { watchHubResource } from "@/lib/hub-computers";
import { cacheHubWorkspaces, cachedHubWorkspaces, hasCachedHubWorkspaces } from "@/lib/hub-workspace-cache";
import { requestComposerWorkspace, takeComposerWorkspace, useComposerWorkspaceRequest } from "@/lib/composer-workspace";
import { HubPersonalContext } from "@/lib/hub-scope";
import { HubModelFavorites } from "./HubModelFavorites";
import { hubThreads } from "./hub-surfaces";
import { Deferred } from "./Deferred";
import { PaneHeader } from "./PaneHeader";
import { Button } from "./ui/button";
import { EmptyState } from "./EmptyState";
import { Spinner } from "./ui/spinner";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "./ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Github,
  ListTodo,
  Lock,
  Plus,
  Users,
} from "lucide-react";
import type { ConnectionsState } from "./HubConnections";
import { ComposerMenu } from "./ComposerMenu";
import type { HubThreadWorkspaceOption } from "./HubThreadComposer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog-base";
import { Field, FieldLabel } from "./ui/field";
import { toast } from "sonner";
import { apiError } from "@/lib/api-error";
import { LinearKeyDialog } from "./LinearConnection";

const Threads = hubThreads.Surface;
const Computers = lazy(() =>
  import("./HubComputers").then((module) => ({ default: module.HubComputers })),
);
const General = lazy(() => import("./HubGeneralSettings"));
const Connections = lazy(() =>
  import("./HubConnections").then((module) => ({ default: module.HubConnections })),
);
const WorkspaceDetails = lazy(() => import("./HubWorkspaceDetails"));

type Owned<T> = {
  organization: Organization;
  value?: T;
  stale: boolean;
  error: string;
};

function rememberWorkspaces(organizationId: string, value: { workspaces: Omit<HubThreadWorkspaceOption, "key" | "organizationId" | "label">[] }) {
  cacheHubWorkspaces(organizationId, value.workspaces.map((workspace) => ({ ...workspace, organizationId })));
}

function useOwnedResources<T>(
  organizations: Organization[],
  path: string,
  livePath = "/live",
  remember?: (organizationId: string, value: T) => void,
) {
  const key = organizations.map((organization) => organization.id).join(",");
  const [resources, setResources] = useState<Map<string, Owned<T>>>(new Map());
  useEffect(() => {
    setResources(
      new Map(
        organizations.map((organization) => [
          organization.id,
          { organization, stale: false, error: "" },
        ]),
      ),
    );
    const stops = organizations.map((organization) => {
      const base = hubThreadBase(organization.id);
      return watchHubResource<T>(
        `${base}${path}`,
        (value, stale) => {
          if (value && !stale) remember?.(organization.id, value);
          setResources((current) => {
            const next = new Map(current);
            next.set(organization.id, {
              organization,
              value,
              stale,
              error: "",
            });
            return next;
          });
        },
        (error) => {
          setResources((current) => {
            const next = new Map(current);
            next.set(organization.id, {
              organization,
              stale: false,
              error,
            });
            return next;
          });
        },
        `${base}${livePath}`,
      );
    });
    return () => stops.forEach((stop) => stop());
  }, [key, path, livePath]);
  return organizations.map(
    (organization) =>
      resources.get(organization.id) ?? {
        organization,
        stale: false,
        error: "",
      },
  );
}

function AllThreads({
  organizations,
  navigate,
}: {
  organizations: Organization[];
  navigate: (route: Route) => void;
}) {
  const resources = useOwnedResources<{ workspaces: Omit<HubThreadWorkspaceOption, "key" | "organizationId" | "label">[] }>(organizations, "/workspaces", "/live", rememberWorkspaces);
  // An account still answering lends the list this device last saw for it, so
  // the composer draws its workspace on the first frame instead of waiting for
  // every account's catalogue. The fresh read replaces it.
  const lists = resources.map(({ organization, value, error }) => ({
    organization,
    settled: !!value || !!error,
    workspaces: value?.workspaces ?? (error ? [] : cachedHubWorkspaces(organization.id)),
    known: !!value || !!error || hasCachedHubWorkspaces(organization.id),
  }));
  // A row names its account only when another account lists a workspace of
  // the same name; otherwise the icon and name are enough to pick it.
  const nameCounts = new Map<string, number>();
  for (const { workspaces } of lists) for (const workspace of workspaces) nameCounts.set(workspace.name, (nameCounts.get(workspace.name) ?? 0) + 1);
  const workspaceOptions = lists.flatMap(({ organization, workspaces }) => workspaces.map((workspace) => ({
    ...workspace,
    key: `${organization.id}:${workspace.id}`,
    organizationId: organization.id,
    label: workspace.name,
    ...((nameCounts.get(workspace.name) ?? 0) > 1 ? { detail: organization.personal ? "Personal" : organization.name } : {}),
  })));
  const [workspaceKey, setWorkspaceKey] = useState("");
  const [message, setMessage] = useState("");
  const [visibility, setVisibility] = useState<"private" | "open">("private");
  // The default is the first workspace of the first account that has one. It
  // is known once every account before it has answered, or has a saved list.
  const firstWithWorkspaces = lists.findIndex(({ workspaces }) => workspaces.length > 0);
  const defaultKnown = firstWithWorkspaces >= 0
    ? lists.slice(0, firstWithWorkspaces + 1).every(({ known }) => known)
    : lists.every(({ settled }) => settled);
  const selectedWorkspace = workspaceOptions.find((workspace) => workspace.key === workspaceKey) ?? workspaceOptions[0];
  const owner = organizations.find((organization) => organization.id === selectedWorkspace?.organizationId) ?? organizations.find((organization) => organization.personal) ?? organizations[0];
  const loaded = defaultKnown;
  // Hold the default once the accounts before it have answered for real, so a
  // workspace added later does not move the composer. A default drawn from a
  // saved list is not held: the fresh one may disagree.
  const defaultSettled = firstWithWorkspaces >= 0 && lists.slice(0, firstWithWorkspaces + 1).every(({ settled }) => settled);
  const requested = useComposerWorkspaceRequest();
  useEffect(() => {
    if (!requested) return;
    const key = `${requested.organizationId}:${requested.workspaceId}`;
    if (!workspaceOptions.some((workspace) => workspace.key === key)) return;
    setWorkspaceKey(key);
    takeComposerWorkspace(requested);
  }, [requested, workspaceOptions]);
  useEffect(() => {
    if (defaultSettled && selectedWorkspace && selectedWorkspace.key !== workspaceKey) setWorkspaceKey(selectedWorkspace.key);
  }, [defaultSettled, selectedWorkspace, workspaceKey]);
  if (!owner) return <EmptyState title="Your account is unavailable" />;
  if (!loaded) return <div className="flex min-h-0 flex-1 items-center justify-center"><Spinner aria-label="Loading workspaces" /></div>;
  const scoped = (next: Route) => navigate({
    ...next,
    organizationId: "all",
    ...(next.name === "threads" && next.threadId ? {} : { ownerOrganizationId: next.organizationId ?? owner.id }),
  });
  return (
    <HubPersonalContext value={owner.personal === true}>
      <HubModelFavorites organizationId={owner.id}>
        {/* Its own boundary, so the thread pane arriving never hides and
            remounts the catalogue reads above it. */}
        <Suspense fallback={<div className="flex min-h-0 flex-1 items-center justify-center"><Spinner aria-label="Loading workspaces" /></div>}>
        <Threads
          key={owner.id}
          organizationId={owner.id}
          showNavigation={false}
          canManageWorkspaces={owner.role !== "member"}
          navigate={scoped}
          newThreadVisibility={visibility}
          newThreadMessage={message}
          onNewThreadMessageChange={setMessage}
          newThreadSharingControl={<ComposerMenu
            ariaLabel="Thread sharing"
            icon={visibility === "private" ? Lock : Users}
            label={visibility === "private" ? "Private" : "Shared"}
            value={visibility}
            options={[{value:"private",label:"Private",icon:Lock},{value:"open",label:"Shared",icon:Users}]}
            onChange={value => setVisibility(value as "private" | "open")}
          />}
          newThreadWorkspaceOptions={workspaceOptions}
          newThreadWorkspaceId={selectedWorkspace?.id}
          onNewThreadWorkspaceChange={workspace => setWorkspaceKey(workspace.key)}
        />
        </Suspense>
      </HubModelFavorites>
    </HubPersonalContext>
  );
}

type ProviderConnection = {
  key: string;
  id: string;
  provider: "github" | "linear";
  label: string;
  status: string;
  availability: "all" | string;
  organizationId: string;
};

function ConnectionsSummary({ organizations, navigate }: { organizations: Organization[]; navigate: (route: Route) => void }) {
  const resources = useOwnedResources<ConnectionsState>(organizations, "/connections");
  const personal = organizations.find((organization) => organization.personal) ?? organizations[0];
  const [adding, setAdding] = useState<"github" | "linear">();
  const [availability, setAvailability] = useState("all");
  const [busy, setBusy] = useState(false);
  const [linearKeyOrganization, setLinearKeyOrganization] = useState<string>();
  const names = new Map(organizations.map((organization) => [organization.id, organization.personal ? "Personal" : organization.name]));
  const rows = new Map<string, ProviderConnection>();
  for (const resource of resources) {
    for (const connection of resource.value?.connections ?? []) {
      if (connection.provider !== "github" || !connection.subject) continue;
      rows.set(connection.id, {
        key: connection.id,
        id: connection.id,
        provider: "github",
        label: connection.label,
        status: connection.status,
        availability: connection.availability,
        organizationId: connection.availability === "all" ? personal?.id ?? resource.organization.id : connection.organization_id,
      });
    }
    for (const account of resource.value?.linearAccounts ?? []) {
      const scopes = account.general ? ["all"] : account.organizationIds ?? [];
      for (const scope of scopes) {
        const key = `${account.id}:${scope}`;
        rows.set(key, {
          key,
          id: account.id,
          provider: "linear",
          label: account.label,
          status: account.status,
          availability: scope,
          organizationId: scope === "all" ? personal?.id ?? resource.organization.id : scope,
        });
      }
    }
  }
  const loaded = resources.every((resource) => resource.value || resource.error);
  const error = resources.find((resource) => resource.error)?.error;
  const availableScopes = (provider: "github" | "linear") => {
    const used = new Set(
      [...rows.values()]
        .filter((row) => row.provider === provider)
        .map((row) => row.availability),
    );
    return [
      { id: "all", label: "All organizations" },
      ...organizations
        .filter((organization) => !organization.personal)
        .map((organization) => ({ id: organization.id, label: organization.name })),
    ].filter((scope) => !used.has(scope.id));
  };
  const scopes = adding ? availableScopes(adding) : [];
  const linearConfigured = resources.some((resource) =>
    resource.value?.providers.some((provider) => provider.id === "linear" && provider.configured),
  );
  const connect = async () => {
    if (!adding || !personal) return;
    const owner = availability === "all" ? personal.id : availability;
    if (adding === "linear" && !linearConfigured) {
      setAdding(undefined);
      setLinearKeyOrganization(owner);
      return;
    }
    setBusy(true);
    try {
      const result = await hubRequest<{ url: string }>(`${hubThreadBase(owner)}/connections/${adding}`, "POST", { scope: "member" });
      window.location.assign(result.url);
    } catch (cause) {
      toast.error(`Couldn't connect ${adding === "github" ? "GitHub" : "Linear"}`, { description: apiError(cause) });
      setBusy(false);
    }
  };
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6" aria-label="Connection settings">
      {error && <p role="alert">{error}</p>}
      {!loaded ? <Spinner aria-label="Loading connections" /> : (["github", "linear"] as const).map((provider) => {
        const providerRows = [...rows.values()].filter((row) => row.provider === provider);
        const nextScopes = availableScopes(provider);
        const label = provider === "github" ? "GitHub" : "Linear";
        const Icon = provider === "github" ? Github : ListTodo;
        return (
          <Card key={provider} className="min-w-0">
            <CardHeader className="flex flex-row items-center gap-3">
              <Icon className="size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <CardTitle role="heading" aria-level={2}>{label}</CardTitle>
                <CardDescription>{providerRows.length ? `${providerRows.length} ${providerRows.length === 1 ? "connection" : "connections"}` : `Connect ${label} to use it in Remy.`}</CardDescription>
              </div>
              <Button
                size={providerRows.length ? "icon-sm" : "sm"}
                variant={providerRows.length ? "outline" : "default"}
                aria-label={providerRows.length ? `Add ${label} connection` : undefined}
                disabled={!nextScopes.length}
                onClick={() => {
                  setAvailability(nextScopes[0]?.id ?? "all");
                  setAdding(provider);
                }}
              >
                {providerRows.length ? <Plus /> : `Connect ${label}`}
              </Button>
            </CardHeader>
            {providerRows.length ? <CardContent>
              <ItemGroup className="gap-2">
                {providerRows.map((row) => (
                  <Item key={row.key} variant="outline" asChild>
                    <Button
                      variant="ghost"
                      className="h-auto w-full justify-start whitespace-normal text-left"
                      data-link
                      onClick={() => navigate({ name: "settings", tab: "connections", organizationId: "all", ownerOrganizationId: row.organizationId })}
                    >
                      <ItemContent className="min-w-0">
                        <ItemTitle className="w-full whitespace-normal break-words">{row.label}</ItemTitle>
                        <ItemDescription>{row.availability === "all" ? "All organizations" : names.get(row.availability) ?? "Organization"} · {row.status === "reauth" ? "Reconnect your account" : "Connected"}</ItemDescription>
                      </ItemContent>
                    </Button>
                  </Item>
                ))}
              </ItemGroup>
            </CardContent> : null}
          </Card>
        );
      })}
      <Dialog open={!!adding} onOpenChange={(open) => { if (!open && !busy) setAdding(undefined); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Connect {adding === "github" ? "GitHub" : "Linear"}</DialogTitle>
            <DialogDescription>Choose where this account is available.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel>Available to</FieldLabel>
            <Select value={availability} onValueChange={setAvailability} disabled={busy}>
              <SelectTrigger aria-label="Available to"><SelectValue /></SelectTrigger>
              <SelectContent>
                {scopes.map((scope) => <SelectItem key={scope.id} value={scope.id}>{scope.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setAdding(undefined)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void connect()}>Connect account</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <LinearKeyDialog
        open={!!linearKeyOrganization}
        busy={busy}
        onOpenChange={(open) => { if (!open && !busy) setLinearKeyOrganization(undefined); }}
        onSubmit={async (token) => {
          if (!linearKeyOrganization) return;
          setBusy(true);
          try {
            await hubRequest(
              `${hubThreadBase(linearKeyOrganization)}/connections/linear`,
              "POST",
              { scope: "member", token },
            );
            setLinearKeyOrganization(undefined);
            toast.success("Your Linear account is connected.");
          } catch (cause) {
            toast.error("Couldn't connect Linear", { description: apiError(cause) });
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

export default function HubAllView({
  organizations,
  route,
  navigate,
  threads = [],
  threadsLoaded = true,
}: {
  organizations: Organization[];
  route: Route;
  navigate: (route: Route) => void;
  threads?: HubThread[];
  threadsLoaded?: boolean;
}) {
  const starts = useThreadStarts();
  const pendingStart = route.name === "threads" && route.threadId
    ? starts.find((start) => start.requestId === route.threadId || start.created?.id === route.threadId)
    : undefined;
  const threadOwnerId = route.name === "threads" && route.threadId
    ? route.ownerOrganizationId
      ?? threads.find((thread) => thread.id === route.threadId)?.access.organizationId
      ?? pendingStart?.organizationId
    : route.ownerOrganizationId;
  const selectedOwner = organizations.find(
    (organization) => organization.id === threadOwnerId,
  );
  const section = route.name === "settings" ? route.tab : route.name;
  const scoped = (next: Route) =>
    navigate({
      ...next,
      organizationId: "all",
      ...(next.name === "threads" && next.threadId ? {} : { ownerOrganizationId: next.organizationId ?? selectedOwner?.id }),
    });
  if (route.name === "threads" && route.threadId && !threadsLoaded && !pendingStart && !route.ownerOrganizationId)
    return <div className="flex min-h-0 flex-1 items-center justify-center"><Spinner aria-label="Loading threads" /></div>;
  // Computers is one list across every account, and names the owner of the
  // page it opens itself, so it never narrows to that owner here.
  if (route.name === "settings" && route.tab === "devices") {
    const personal = organizations.find((organization) => organization.personal) ?? organizations[0];
    return (
      <HubModelFavorites organizationId={personal?.id}>
        <Deferred open>
          <Computers accounts={organizations} all />
        </Deferred>
      </HubModelFavorites>
    );
  }
  if (threadOwnerId && !selectedOwner)
    return <EmptyState title="This account is unavailable" />;
  if (route.name === "threads" && route.threadId && !selectedOwner)
    return <EmptyState title="This thread is unavailable" />;
  if (selectedOwner)
    return (
      <HubPersonalContext value={selectedOwner.personal === true}>
        <HubModelFavorites organizationId={selectedOwner.id}>
          <div className="flex min-h-0 flex-1 flex-col overflow-auto">
            {section !== "workspaces" && section !== "threads" && (
              <div className="shrink-0 px-5 pt-3">
                <Button
                  variant="ghost"
                  data-link
                  onClick={() =>
                    navigate({
                      name: route.name,
                      ...(route.name === "settings" ? { tab: route.tab } : {}),
                      organizationId: "all",
                    } as Route)
                  }
                >
                  Back to all
                </Button>
              </div>
            )}
            <Deferred open>
              {section === "threads" && (
                <>
                  {route.name === "threads" && !route.threadId && (
                    <PaneHeader
                      sidebar
                      crumbs={[
                        {
                          label: "Threads",
                          onClick: () =>
                            navigate({ name: "threads", organizationId: "all" }),
                        },
                        {
                          label: selectedOwner.personal
                            ? "Personal"
                            : selectedOwner.name,
                        },
                      ]}
                    />
                  )}
                  <Threads
                    organizationId={selectedOwner.id}
                    showNavigation={false}
                    canManageWorkspaces={selectedOwner.role !== "member"}
                    threadId={
                      route.name === "threads" ? route.threadId : undefined
                    }
                    navigate={scoped}
                  />
                </>
              )}
              {section === "connections" && (
                <Connections organizationId={selectedOwner.id} />
              )}
              {section === "workspaces" &&
                route.name === "workspaces" &&
                route.workspaceId && (
                  <WorkspaceDetails
                    key={`${selectedOwner.id}:${route.workspaceId}`}
                    organizationId={selectedOwner.id}
                    workspaceId={route.workspaceId}
                    owner={selectedOwner}
                    onBack={() =>
                      navigate({ name: "workspaces", organizationId: "all" })
                    }
                    onNewThread={() => {
                      requestComposerWorkspace({ organizationId: selectedOwner.id, workspaceId: route.workspaceId! });
                      navigate({ name: "threads", organizationId: "all" });
                    }}
                  />
                )}
            </Deferred>
          </div>
        </HubModelFavorites>
      </HubPersonalContext>
    );
  if (route.name === "threads")
    return (
      <AllThreads
        organizations={organizations}
        navigate={navigate}
      />
    );
  if (route.name === "settings" && route.tab === "general") {
    const personal =
      organizations.find((organization) => organization.personal) ??
      organizations[0];
    return personal ? (
      <HubPersonalContext value={personal.personal === true}>
        <HubModelFavorites organizationId={personal.id}>
          <div className="min-h-0 overflow-auto px-5 py-6">
            <General organizationId={personal.id} />
          </div>
        </HubModelFavorites>
      </HubPersonalContext>
    ) : (
      <EmptyState title="Your account is unavailable" />
    );
  }
  if (route.name === "settings" && route.tab === "connections")
    return <ConnectionsSummary organizations={organizations} navigate={navigate} />;
  return (
    <EmptyState
      title="Choose an account"
      description="Choose Personal or an organization from the sidebar."
    />
  );
}
