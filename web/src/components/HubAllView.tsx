import { lazy, useEffect, useMemo, useState } from "react";
import type {
  BoardProjection,
  ComputerSummary,
  HubThread,
  Organization,
  RoutingRule,
} from "@remy/contract";
import type { Route } from "@/lib/route";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { useThreadStarts } from "@/lib/hub-thread-start";
import { watchHubResource } from "@/lib/hub-computers";
import { HubPersonalContext } from "@/lib/hub-scope";
import { HubModelFavorites } from "./HubModelFavorites";
import { Deferred } from "./Deferred";
import { PaneHeader } from "./PaneHeader";
import { Button } from "./ui/button";
import { EmptyState } from "./EmptyState";
import { Spinner } from "./ui/spinner";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
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
  Building2,
  Circle,
  Laptop,
  Lock,
  Plug,
  Route as RouteIcon,
  UserRound,
  Users,
} from "lucide-react";
import { HubAccountPickerDialog } from "./HubAccountPickerDialog";
import type { ConnectionsState } from "./HubConnections";
import { ComposerMenu } from "./ComposerMenu";
import type { HubThreadWorkspaceOption } from "./HubThreadComposer";

const Threads = lazy(() => import("./HubThreads"));
const Board = lazy(() => import("./HubBoard"));
const Inbox = lazy(() =>
  import("./HubInbox").then((module) => ({ default: module.HubInbox })),
);
const Computers = lazy(() =>
  import("./HubComputers").then((module) => ({ default: module.HubComputers })),
);
const General = lazy(() => import("./HubGeneralSettings"));
const Connections = lazy(() =>
  import("./HubConnections").then((module) => ({ default: module.HubConnections })),
);
const Routing = lazy(() =>
  import("./HubRouting").then((module) => ({ default: module.HubRouting })),
);
const Environments = lazy(() =>
  import("./EnvironmentsSettings").then((module) => ({
    default: module.EnvironmentsSettings,
  })),
);
const WorkspaceDetails = lazy(() => import("./HubWorkspaceDetails"));

type Owned<T> = {
  organization: Organization;
  value?: T;
  stale: boolean;
  error: string;
};

function useOwnedResources<T>(
  organizations: Organization[],
  path: string,
  livePath = "/live",
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

function OwnerMark({ organization }: { organization: Organization }) {
  const Icon = organization.personal ? UserRound : Building2;
  return (
    <Icon
      aria-label={organization.personal ? "Personal" : organization.name}
    />
  );
}

function OwnerDescription({
  organization,
  detail,
}: {
  organization: Organization;
  detail?: string;
}) {
  return (
    <>
      {organization.personal ? "Personal" : organization.name}
      {detail ? ` · ${detail}` : ""}
    </>
  );
}

function AccountAction({
  organizations,
  label,
  title,
  description,
  action = "Continue",
  onSelect,
}: {
  organizations: Organization[];
  label: string;
  title: string;
  description: string;
  action?: string;
  onSelect: (organizationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      <HubAccountPickerDialog
        open={open}
        onOpenChange={setOpen}
        organizations={organizations}
        title={title}
        description={description}
        action={action}
        onSelect={(organizationId) => {
          setOpen(false);
          onSelect(organizationId);
        }}
      />
    </>
  );
}

function AllThreads({
  organizations,
  navigate,
}: {
  organizations: Organization[];
  navigate: (route: Route) => void;
}) {
  const resources = useOwnedResources<{ workspaces: Omit<HubThreadWorkspaceOption, "key" | "organizationId" | "label">[] }>(organizations, "/workspaces");
  const workspaceOptions = resources.flatMap(({ organization, value }) => (value?.workspaces ?? []).map((workspace) => ({
    ...workspace,
    key: `${organization.id}:${workspace.id}`,
    organizationId: organization.id,
    label: `${workspace.name} · ${organization.personal ? "Personal" : organization.name}`,
  })));
  const [workspaceKey, setWorkspaceKey] = useState("");
  const [message, setMessage] = useState("");
  const [visibility, setVisibility] = useState<"private" | "open">("private");
  const selectedWorkspace = workspaceOptions.find((workspace) => workspace.key === workspaceKey) ?? workspaceOptions[0];
  const owner = organizations.find((organization) => organization.id === selectedWorkspace?.organizationId) ?? organizations.find((organization) => organization.personal) ?? organizations[0];
  const loaded = resources.every((resource) => resource.value || resource.error);
  useEffect(() => {
    if (selectedWorkspace && selectedWorkspace.key !== workspaceKey) setWorkspaceKey(selectedWorkspace.key);
  }, [selectedWorkspace, workspaceKey]);
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
      </HubModelFavorites>
    </HubPersonalContext>
  );
}

function AllTasks({
  organizations,
  navigate,
}: {
  organizations: Organization[];
  navigate: (route: Route) => void;
}) {
  const resources = useOwnedResources<{ items: BoardProjection[] }>(
    organizations,
    "/board/tickets",
    "/board/live",
  );
  const [saving, setSaving] = useState("");
  const [writeError, setWriteError] = useState("");
  const items = useMemo(
    () =>
      resources.flatMap((resource) =>
        (resource.value?.items ?? []).map((item) => ({
          organization: resource.organization,
          item,
        })),
      ),
    [resources],
  );
  const loaded = resources.every((resource) => resource.value || resource.error);
  const error = writeError || resources.find((resource) => resource.error)?.error;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6"
      aria-label="Tasks"
    >
      <div className="flex items-center justify-end">
        <AccountAction
          organizations={organizations}
          label="Create ticket"
          title="Create ticket"
          description="Choose who owns this ticket."
          action="Choose account"
          onSelect={(organizationId) =>
            navigate({
              name: "board",
              organizationId: "all",
              ownerOrganizationId: organizationId,
            })
          }
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {!loaded ? (
        <p role="status">Reading your Tasks…</p>
      ) : items.length ? (
        <ItemGroup>
          {items.map(({ organization, item }) => {
            const key = item.fields.keyPrefix
              ? `${item.fields.keyPrefix}-${item.fields.number}`
              : "";
            const itemKey = `${organization.id}:${item.id}`;
            return (
              <Item key={itemKey} variant="outline">
                <ItemMedia>
                  <Circle />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>
                    <Button
                      variant="link"
                      className="h-auto justify-start whitespace-normal p-0 text-left"
                      data-link
                      onClick={() =>
                        navigate({
                          name: "ticket",
                          key: item.id,
                          organizationId: "all",
                          ownerOrganizationId: organization.id,
                        })
                      }
                    >
                      {key ? `${key} · ` : ""}
                      {String(item.fields.title)}
                    </Button>
                  </ItemTitle>
                  <ItemDescription>
                    <OwnerDescription
                      organization={organization}
                      detail={`Updated by ${item.lastActor.label}`}
                    />
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Select
                    value={String(item.fields.status ?? "backlog")}
                    disabled={saving === itemKey}
                    onValueChange={(status) => {
                      setSaving(itemKey);
                      setWriteError("");
                      void hubRequest(
                        `${hubThreadBase(organization.id)}/board/events`,
                        "POST",
                        {
                          entity: "ticket",
                          entityId: item.id,
                          kind: "status",
                          payload: { status },
                        },
                      )
                        .catch((caught) =>
                          setWriteError(
                            caught instanceof Error
                              ? caught.message
                              : "This ticket could not be updated.",
                          ),
                        )
                        .finally(() => setSaving(""));
                    }}
                  >
                    <SelectTrigger aria-label={`Status for ${item.fields.title}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="backlog">Backlog</SelectItem>
                      <SelectItem value="todo">Todo</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="needs_input">Needs input</SelectItem>
                      <SelectItem value="pr_review">PR review</SelectItem>
                      <SelectItem value="done">Done</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </ItemActions>
              </Item>
            );
          })}
        </ItemGroup>
      ) : (
        <EmptyState
          title="No tickets yet"
          description="Create a ticket to plan the next outcome."
        />
      )}
    </section>
  );
}

function AllInbox({
  organizations,
  navigate,
}: {
  organizations: Organization[];
  navigate: (route: Route) => void;
}) {
  const resources = useOwnedResources<{ agents: BoardProjection[] }>(
    organizations,
    "/agents",
    "/board/live",
  );
  const agents = useMemo(
    () =>
      resources.flatMap((resource) =>
        (resource.value?.agents ?? []).map((agent) => ({
          organization: resource.organization,
          agent,
        })),
      ),
    [resources],
  );
  const loaded = resources.every((resource) => resource.value || resource.error);
  const error = resources.find((resource) => resource.error)?.error;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6"
      aria-label="Inbox"
    >
      <div className="flex items-center justify-end">
        <AccountAction
          organizations={organizations}
          label="Create agent"
          title="Create agent"
          description="Choose who owns this agent."
          action="Choose account"
          onSelect={(organizationId) =>
            navigate({
              name: "inbox",
              organizationId: "all",
              ownerOrganizationId: organizationId,
            })
          }
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {!loaded ? (
        <Spinner aria-label="Loading agents" />
      ) : agents.length ? (
        <ItemGroup>
          {agents.map(({ organization, agent }) => (
            <Item key={`${organization.id}:${agent.id}`} variant="outline" asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-start whitespace-normal text-left"
                data-link
                onClick={() =>
                  navigate({
                    name: "inbox",
                    agent: agent.id,
                    organizationId: "all",
                    ownerOrganizationId: organization.id,
                  })
                }
              >
                <ItemMedia>
                  <OwnerMark organization={organization} />
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle>{String(agent.fields.name)}</ItemTitle>
                  <ItemDescription>
                    <OwnerDescription
                      organization={organization}
                      detail={String(
                        agent.fields.role ??
                          agent.fields.description ??
                          "Coding agent",
                      )}
                    />
                  </ItemDescription>
                </ItemContent>
              </Button>
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <EmptyState
          title="No agents yet"
          description="Write one to hand work to, then talk to it here."
        />
      )}
    </section>
  );
}

type EnvironmentState = {
  environments: {
    id: string;
    name: string;
    variables: { name: string }[];
  }[];
};

type SummaryResource = {
  computers?: ComputerSummary[];
  environments?: EnvironmentState["environments"];
  connections?: ConnectionsState["connections"];
  rules?: RoutingRule[];
};

function SettingsSummary({
  organizations,
  kind,
  navigate,
}: {
  organizations: Organization[];
  kind: "devices" | "environments" | "connections" | "routing";
  navigate: (route: Route) => void;
}) {
  const path = kind === "devices" ? "/computers" : `/${kind}`;
  const live =
    kind === "devices" || kind === "environments" ? "/computers/live" : "/live";
  const resources = useOwnedResources<SummaryResource>(organizations, path, live);
  const rows = resources.flatMap((resource) => {
    if (kind === "devices")
      return (resource.value?.computers ?? []).map((item) => ({
        id: item.computerId,
        title: item.name,
        detail: item.availability === "offline" ? "Offline" : "Online",
        organization: resource.organization,
        icon: Laptop,
      }));
    if (kind === "environments")
      return (resource.value?.environments ?? []).map((item) => ({
        id: item.id,
        title: item.name,
        detail: `${item.variables.length} ${item.variables.length === 1 ? "variable" : "variables"}`,
        organization: resource.organization,
        icon: Plug,
      }));
    if (kind === "connections")
      return (resource.value?.connections ?? []).map((item) => ({
        id: item.id,
        title: item.label,
        detail:
          item.status === "reauth" ? "Reconnect your account" : "Connected",
        organization: resource.organization,
        icon: Plug,
      }));
    return (resource.value?.rules ?? []).map((item) => ({
      id: item.id,
      title: item.name,
      detail: "Routing rule",
      organization: resource.organization,
      icon: RouteIcon,
    }));
  });
  const loaded = resources.every((resource) => resource.value || resource.error);
  const error = resources.find((resource) => resource.error)?.error;
  const labels = {
    devices: [
      "Manage computers",
      "Computer settings",
      "Choose the account whose computers you want to manage.",
    ],
    environments: [
      "Add environment",
      "Environment settings",
      "Choose the account that owns this environment.",
    ],
    connections: [
      "Connect account",
      "Connection settings",
      "Choose the account that owns this connection.",
    ],
    routing: [
      "Add rule",
      "Routing settings",
      "Choose the account that owns this routing rule.",
    ],
  } as const;
  const [label, title, description] = labels[kind];
  const empty = {
    devices: [
      "No computers yet",
      "Connect a computer to run your threads.",
    ],
    environments: [
      "No environments yet",
      "Add an environment when workspaces need shared values.",
    ],
    connections: [
      "No connections yet",
      "Connect an account when you want Remy to use another tool.",
    ],
    routing: [
      "No routing rules yet",
      "Add a rule when work needs a specific computer.",
    ],
  } as const;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6"
      aria-label={title}
    >
      <div className="flex items-center justify-end">
        <AccountAction
          organizations={organizations}
          label={label}
          title={title}
          description={description}
          onSelect={(organizationId) =>
            navigate({
              name: "settings",
              tab: kind,
              organizationId: "all",
              ownerOrganizationId: organizationId,
            })
          }
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {!loaded ? (
        <Spinner aria-label={`Loading ${kind}`} />
      ) : rows.length ? (
        <ItemGroup>
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <Item
                key={`${row.organization.id}:${row.id}`}
                variant="outline"
                asChild
              >
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal text-left"
                  data-link
                  onClick={() =>
                    navigate({
                      name: "settings",
                      tab: kind,
                      organizationId: "all",
                      ownerOrganizationId: row.organization.id,
                      ...(kind === "devices" ? { deviceId: row.id } : {}),
                    })
                  }
                >
                  <ItemMedia>
                    <Icon />
                  </ItemMedia>
                  <ItemContent className="min-w-0">
                    <ItemTitle>{row.title}</ItemTitle>
                    <ItemDescription>
                      <OwnerDescription
                        organization={row.organization}
                        detail={row.detail}
                      />
                    </ItemDescription>
                  </ItemContent>
                </Button>
              </Item>
            );
          })}
        </ItemGroup>
      ) : (
        <EmptyState title={empty[kind][0]} description={empty[kind][1]} />
      )}
    </section>
  );
}

export default function HubAllView({
  organizations,
  route,
  userId,
  navigate,
  threads = [],
  threadsLoaded = true,
}: {
  organizations: Organization[];
  route: Route;
  userId: string;
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
                      name: route.name === "ticket" ? "board" : route.name,
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
              {(section === "board" || section === "ticket") && (
                <Board
                  organizationId={selectedOwner.id}
                  ticketId={route.name === "ticket" ? route.key : undefined}
                  navigate={scoped}
                />
              )}
              {section === "inbox" && (
                <Inbox
                  organizationId={selectedOwner.id}
                  userId={userId}
                  agentId={route.name === "inbox" ? route.agent : undefined}
                  choose={(agent) =>
                    scoped({
                      name: "inbox",
                      organizationId: selectedOwner.id,
                      agent,
                    })
                  }
                />
              )}
              {section === "devices" && (
                <div className="p-6">
                  <Computers organizationId={selectedOwner.id} />
                </div>
              )}
              {section === "environments" && (
                <div className="p-6">
                  <Environments organizationId={selectedOwner.id} />
                </div>
              )}
              {section === "connections" && (
                <Connections organizationId={selectedOwner.id} />
              )}
              {section === "routing" && (
                <Routing organizationId={selectedOwner.id} />
              )}
              {section === "workspaces" &&
                route.name === "workspaces" &&
                route.workspaceId && (
                  <WorkspaceDetails
                    organizationId={selectedOwner.id}
                    workspaceId={route.workspaceId}
                    role={selectedOwner.role}
                    onBack={() =>
                      navigate({ name: "workspaces", organizationId: "all" })
                    }
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
  if (route.name === "board")
    return <AllTasks organizations={organizations} navigate={navigate} />;
  if (route.name === "inbox")
    return <AllInbox organizations={organizations} navigate={navigate} />;
  if (route.name === "settings" && (route.tab === "general" || route.tab === "devices")) {
    const personal =
      organizations.find((organization) => organization.personal) ??
      organizations[0];
    return personal ? (
      <HubPersonalContext value={personal.personal === true}>
        <HubModelFavorites organizationId={personal.id}>
          {route.tab === "devices" ? (
            <div className="min-h-0 overflow-auto p-6">
              <Deferred open>
                <Computers organizationId={personal.id} />
              </Deferred>
            </div>
          ) : (
            <div className="min-h-0 overflow-auto px-5 py-6">
              <General organizationId={personal.id} />
            </div>
          )}
        </HubModelFavorites>
      </HubPersonalContext>
    ) : (
      <EmptyState title="Your account is unavailable" />
    );
  }
  if (
    route.name === "settings" &&
    ["environments", "connections", "routing"].includes(route.tab)
  )
    return (
      <SettingsSummary
        organizations={organizations}
        kind={route.tab as "devices" | "environments" | "connections" | "routing"}
        navigate={navigate}
      />
    );
  return (
    <EmptyState
      title="Choose an account"
      description="Choose Personal or an organization from the sidebar."
    />
  );
}
