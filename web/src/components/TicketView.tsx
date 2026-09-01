import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowUpRight,
  CirclePlus,
  Folder,
  FolderGit2,
  GitBranch,
  Link2,
  Link2Off,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageHeader,
} from "@/components/ui/message";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EditableName } from "@/components/EditableName";
import { Markdown, type Mention } from "@/components/Markdown";
import { MentionField } from "@/components/MentionField";
import { ModelPickerButton } from "@/components/ModelPicker";
import { PaneHeader } from "@/components/PaneHeader";
import { WorkspaceMark } from "@/components/WorkspaceIcon";
import { NewTicketDialog } from "@/components/Board";
import { AssigneeAvatar, StatusIcon, SubTicketProgress } from "@/components/TicketGlyphs";
import { apiError } from "@/lib/api-error";
import { deviceIcon } from "@/lib/devices";
import type { ModelChoice } from "@/lib/providers";
import { devicesForWorkspace, localWorkspace } from "@/lib/projects";
import {
  DERIVED_STATUSES,
  STATUS_LABEL,
  TICKET_STATUSES,
  WORKSPACE_AGENT,
  YOU,
  byRank,
  deviceForTicket,
  people,
  shortDate,
} from "@/lib/tickets";
import { useStore } from "@/state/store";
import type { Agent, Ticket, TicketActivity, TicketStatus, Workspace } from "@/state/types";

/// One ticket: what it is, who has it, what it is broken into, and every thread
/// that has worked on it.
///
/// A reading column down the middle and its properties down the side, so the
/// description keeps a comfortable measure however wide the window is. The
/// activity feed at the foot is the log the board is built from rather than a
/// summary of it, so it cannot say something different from what happened.

export function TicketView({
  ticket,
  onBack,
  onOpenTicket,
  onOpenThread,
  onOpenWorkspace,
  onOpenAgent,
}: {
  ticket: Ticket;
  onBack: () => void;
  onOpenTicket: (key: string) => void;
  onOpenThread: (chatId: string) => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenAgent: (handle: string) => void;
}) {
  const projects = useStore((s) => s.projects);
  const servers = useStore((s) => s.servers);
  const workspaces = useStore((s) => s.workspaces);
  const boardDevices = useStore((s) => s.boardDevices);
  const agents = useStore((s) => s.agents);
  const linkedChatIds = useMemo(
    () => new Set(ticket.threads.map((link) => link.chatId)),
    [ticket.threads],
  );
  const chats = useStore(useShallow((s) => s.chats.filter((chat) => linkedChatIds.has(chat.id))));
  const tickets = useStore((s) => s.tickets);
  const settings = useStore((s) => s.settings);
  const updateTicket = useStore((s) => s.updateTicket);
  const moveTicket = useStore((s) => s.moveTicket);
  const deleteTicket = useStore((s) => s.deleteTicket);
  const startTicket = useStore((s) => s.startTicket);
  const commentOnTicket = useStore((s) => s.commentOnTicket);
  const editTicketComment = useStore((s) => s.editTicketComment);
  const deleteTicketComment = useStore((s) => s.deleteTicketComment);
  const detachThread = useStore((s) => s.detachThread);
  const readActivity = useStore((s) => s.ticketActivity);

  const [activity, setActivity] = useState<TicketActivity[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startChoice, setStartChoice] = useState<ModelChoice>({ provider: "claude", model: "" });
  const [startCheckout, setStartCheckout] = useState<"main" | "worktree">("main");
  const [editingBody, setEditingBody] = useState(false);
  const [draft, setDraft] = useState(ticket.body);

  const project = projects.find((entry) => entry.id === ticket.projectId);
  const workspace = project ? localWorkspace(project, workspaces) : undefined;
  const gitWorkspace = Boolean(workspace?.worktrees.length);
  const defaultStartChoice = workspace?.provider
    ? { provider: workspace.provider, model: workspace.model ?? "", effort: workspace.effort ?? "" }
    : {
        provider: settings?.defaultProvider ?? "claude",
        model: settings?.defaultModel ?? "",
        effort: settings?.defaultEffort ?? "",
      };
  const defaultStartCheckout = gitWorkspace ? settings?.defaultCheckout ?? "main" : "main";
  const device = deviceForTicket(ticket, boardDevices, servers);
  const eligibleDevices = workspace
    ? devicesForWorkspace(workspace, workspaces, servers)
    : device ? [device] : [];
  const parent = ticket.parentId ? tickets.find((entry) => entry.id === ticket.parentId) : undefined;
  const children = useMemo(
    () => tickets.filter((entry) => entry.parentId === ticket.id).sort(byRank),
    [tickets, ticket.id],
  );
  const done = children.filter((c) => c.status === "done" || c.status === "cancelled").length;

  const refreshActivity = useCallback(() => {
    void readActivity(ticket.id)
      .then(setActivity)
      .catch(() => {
        // The feed reads the same events the pane already shows; a failure here
        // is not worth interrupting the ticket for.
      });
  }, [readActivity, ticket.id]);

  useEffect(refreshActivity, [refreshActivity, ticket.updatedAt]);
  useEffect(() => setDraft(ticket.body), [ticket.body, ticket.id]);

  const save = async (patch: Record<string, unknown>, what: string) => {
    try {
      await updateTicket(ticket.id, patch);
    } catch (error) {
      toast.error(`Couldn't save ${what}`, { description: apiError(error) });
    }
  };

  const setStartDialogOpen = (open: boolean) => {
    if (open) {
      setStartChoice(defaultStartChoice);
      setStartCheckout(defaultStartCheckout);
    }
    setStartOpen(open);
  };

  const beginThread = () => {
    setStarting(true);
    void startTicket(ticket.id, {
      provider: startChoice.provider,
      model: startChoice.model,
      effort: startChoice.effort,
      checkout: startCheckout,
    })
      .then((thread) => onOpenThread(thread.id))
      .catch((error) => {
        setStarting(false);
        toast.error("Couldn't start that thread", { description: apiError(error) });
      });
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <PaneHeader
        crumbs={[
          // Named for the section it returns to, which is what the sidebar
          // calls it — the board is one of that section's two tabs.
          { label: "Tasks", onClick: onBack },
          ...(parent ? [{ label: parent.key, onClick: () => onOpenTicket(parent.key) }] : []),
          { label: ticket.key },
        ]}
      >
        {(ticket.status === "backlog" || ticket.status === "todo") && (
          <Dialog open={startOpen} onOpenChange={setStartDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={starting}>
                <Play data-icon="inline-start" />
                Start thread
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Start thread</DialogTitle>
                <DialogDescription>Choose how this thread starts.</DialogDescription>
              </DialogHeader>
              <FieldGroup className="gap-5 py-1">
                <Field>
                  <FieldLabel htmlFor="ticket-start-provider">Provider</FieldLabel>
                  <ModelPickerButton
                    id="ticket-start-provider"
                    value={startChoice}
                    onPick={setStartChoice}
                    className="w-full"
                  />
                </Field>
                <Field>
                  <FieldLabel>Checkout</FieldLabel>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={startCheckout}
                    onValueChange={(value) => {
                      if (value === "main" || value === "worktree") setStartCheckout(value);
                    }}
                    className="w-full"
                  >
                    <ToggleGroupItem value="worktree" disabled={!gitWorkspace} className="flex-1">
                      <FolderGit2 />
                      New worktree
                    </ToggleGroupItem>
                    <ToggleGroupItem value="main" className="flex-1">
                      <Folder />
                      Main checkout
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              </FieldGroup>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={starting}>Cancel</Button>
                </DialogClose>
                <Button type="button" disabled={starting} onClick={beginThread}>
                  <Play data-icon="inline-start" />
                  {starting ? "Starting…" : "Start thread"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${ticket.key}`}>
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Delete ticket</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {ticket.key}?</AlertDialogTitle>
              <AlertDialogDescription>
                {children.length > 0
                  ? `Its ${children.length} sub-ticket${children.length === 1 ? "" : "s"} stay, without a parent.`
                  : "Threads that worked on it keep running."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void deleteTicket(ticket.id)
                    .then(onBack)
                    .catch((error) => toast.error("Couldn't delete that ticket", { description: apiError(error) }))
                }
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PaneHeader>

      <div className="flex min-h-0 flex-1">
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-6 py-7">
            <div className="flex flex-col gap-2">
              <h1>
                <EditableName
                  value={ticket.title}
                  label="ticket title"
                  className="text-2xl leading-tight font-semibold"
                  onCommit={(title) => void save({ title }, "the title")}
                />
              </h1>
              <p className="text-xs text-muted-foreground">
                {project?.name} · created {shortDate(ticket.createdAt)}
              </p>
            </div>

            <section className="flex flex-col gap-2">
              {editingBody ? (
                <div className="flex flex-col gap-2">
                  <Textarea
                    autoFocus
                    rows={10}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="What has to change, and how you will know it worked."
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingBody(false);
                        void save({ body: draft }, "the description");
                      }}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setDraft(ticket.body);
                        setEditingBody(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setEditingBody(true)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    setEditingBody(true);
                  }}
                  className="-mx-3 cursor-text rounded-lg border border-transparent px-3 py-2 hover:border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {ticket.body ? (
                    <Markdown text={ticket.body} />
                  ) : (
                    <p className="text-sm text-muted-foreground">Add a description.</p>
                  )}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Sub-tickets
                </h2>
                {children.length > 0 && <SubTicketProgress done={done} total={children.length} />}
                {!parent && (
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAddingSub(true)}>
                    <Plus />
                    Add
                  </Button>
                )}
              </div>
              {children.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {parent ? "A sub-ticket cannot have its own." : "Break this into pieces if it is too big."}
                </p>
              ) : (
                <ul className="flex flex-col">
                  {children.map((child) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        data-link
                        onClick={() => onOpenTicket(child.key)}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <StatusIcon status={child.status} />
                        <span className="font-mono text-[11px] text-muted-foreground">{child.key}</span>
                        <span className="min-w-0 flex-1 truncate text-sm">{child.title}</span>
                        <AssigneeAvatar
                          assignee={child.assigneeAgentId}
                          agents={agents}
                          workspace={workspace}
                          workspaceName={project?.name}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Threads</h2>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAttaching(true)}>
                  <Link2 />
                  Attach a thread
                </Button>
              </div>
              {ticket.threads.length === 0 ? (
                <p className="text-sm text-muted-foreground">No thread has worked on this yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {ticket.threads.map((link) => {
                    const chat = chats.find((entry) => entry.id === link.chatId);
                    const agent = agents.find((entry) => entry.id === link.agentId);
                    return (
                      <li
                        key={link.chatId}
                        className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2"
                      >
                        <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">
                            {chat?.title ?? "A thread on another machine"}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {agent ? `${agent.name} · ` : ""}
                            {link.linkedBy === "runner" ? "started by the board" : "attached by you"}
                          </span>
                        </span>
                        {chat && chat.state !== "idle" && (
                          <Badge variant={chat.state === "needs_input" ? "warning" : "info"}>
                            {chat.state === "needs_input" ? "Needs you" : "Working"}
                          </Badge>
                        )}
                        {chat && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                data-link
                                aria-label="Open thread"
                                onClick={() => onOpenThread(link.chatId)}
                              >
                                <ArrowUpRight />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Open thread</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label="Detach thread"
                              onClick={() => void detachThread(ticket.id, link.chatId, link.deviceId)}
                            >
                              <Link2Off />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Detach thread</TooltipContent>
                        </Tooltip>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <Separator />

            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Activity</h2>
              <ActivityFeed
                activity={activity}
                agents={agents}
                workspace={workspace}
                onOpenAgent={onOpenAgent}
                onEdit={async (commentId, body) => {
                  try {
                    await editTicketComment(ticket.id, commentId, body);
                    refreshActivity();
                  } catch (error) {
                    toast.error("Couldn't edit that comment", { description: apiError(error) });
                    throw error;
                  }
                }}
                onDelete={async (commentId) => {
                  try {
                    await deleteTicketComment(ticket.id, commentId);
                    refreshActivity();
                  } catch (error) {
                    toast.error("Couldn't delete that comment", { description: apiError(error) });
                    throw error;
                  }
                }}
              />
              <CommentBox
                agents={agents}
                onSend={async (body) => {
                  try {
                    await commentOnTicket(ticket.id, body);
                    refreshActivity();
                  } catch (error) {
                    toast.error("Couldn't add that comment", { description: apiError(error) });
                  }
                }}
              />
            </section>
          </div>
        </ScrollArea>

        {/* Properties sit beside the reading column rather than above it, so the
            description keeps its measure and nothing has to be scrolled past to
            change an assignee. */}
        <aside className="hidden w-64 shrink-0 flex-col gap-5 border-l border-border px-4 py-7 lg:flex">
          <Property label="Status" htmlFor="ticket-status">
            <Select
              value={ticket.status}
              onValueChange={(value) => void moveTicket(ticket.id, value as TicketStatus)}
            >
              <SelectTrigger id="ticket-status" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  {TICKET_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      <StatusIcon status={status} decorative />
                      {STATUS_LABEL[status]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {DERIVED_STATUSES.includes(ticket.status) && ticket.threads.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Remy moves this between In progress and Needs input while a thread is on it.
              </p>
            )}
          </Property>

          <Property label="Assignee" htmlFor="ticket-assignee">
            <Select
              value={ticket.assigneeAgentId ?? "none"}
              onValueChange={(value) =>
                void save({ assigneeAgentId: value === "none" ? "" : value }, "the assignee")
              }
            >
              <SelectTrigger id="ticket-assignee" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectGroup>
                  <SelectItem value="none">
                    {/* An avatar slot of its own, so every name in the list
                        starts in the same column. */}
                    <AssigneeAvatar agents={agents} />
                    Nobody
                  </SelectItem>
                  {/* You first, then the workspace itself: a ticket you keep is
                      the common case, and an agent only starts on one that was
                      handed to it. */}
                  {people(agents, workspace?.name ?? project?.name).map((person) => (
                    <SelectItem key={person.id} value={person.id}>
                      <AssigneeAvatar
                        assignee={person.id}
                        agents={agents}
                        workspace={workspace}
                        workspaceName={project?.name}
                      />
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {ticket.assigneeAgentId === WORKSPACE_AGENT && (
              <p className="text-[11px] text-muted-foreground">
                This workspace's own default model, with no agent in front of it.
              </p>
            )}
          </Property>

          {ticket.branch && (
            <Property label="Branch">
              <span className="flex items-center gap-1.5 font-mono text-xs break-all text-muted-foreground">
                <GitBranch className="size-3.5 shrink-0" />
                {ticket.branch}
              </span>
            </Property>
          )}

          <Property label="Device" htmlFor="ticket-device">
            {eligibleDevices.length > 1 ? (
              <Select
                value={device?.id ?? ""}
                onValueChange={(value) => {
                  const next = boardDevices.find((entry) => entry.serverId === value);
                  if (next) void save({ deviceId: next.deviceId }, "the device");
                }}
              >
                <SelectTrigger id="ticket-device" size="sm" className="w-full">
                  <SelectValue placeholder="Unknown" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectGroup>
                    {eligibleDevices.map((server) => {
                      const Icon = deviceIcon(server.icon);
                      return (
                        <SelectItem
                          key={server.id}
                          value={server.id}
                          disabled={!boardDevices.some((entry) => entry.serverId === server.id)}
                        >
                          <Icon className="size-3.5" />
                          {server.name}
                        </SelectItem>
                      );
                    })}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : device ? (
              <span id="ticket-device" className="flex items-center gap-2 text-sm">
                {(() => {
                  const Icon = deviceIcon(device.icon);
                  return <Icon className="size-4 text-muted-foreground" />;
                })()}
                <span className="truncate">{device.name}</span>
              </span>
            ) : (
              <span id="ticket-device" className="text-sm text-muted-foreground">Unknown</span>
            )}
          </Property>

          <Property label="Workspace">
            {workspace ? (
              <button
                type="button"
                data-link
                className="flex w-full items-center gap-1.5 rounded text-left text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                onClick={() => onOpenWorkspace(workspace.id)}
              >
                <WorkspaceMark home={false} workspace={workspace} size="sm" />
                <span className="truncate">{workspace.name}</span>
              </button>
            ) : (
              // The project exists on some machine; this one just has not cloned
              // it, so there is nothing here to open.
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Folder className="size-4 shrink-0" />
                {project?.name ?? "—"}
              </span>
            )}
          </Property>
        </aside>
      </div>

      <AttachThreadDialog
        open={attaching}
        onOpenChange={setAttaching}
        ticket={ticket}
        onAttached={refreshActivity}
      />
      <NewTicketDialog
        open={addingSub}
        onOpenChange={setAddingSub}
        projects={projects}
        projectId={ticket.projectId}
        parentId={ticket.id}
        onCreated={onOpenTicket}
      />
    </main>
  );
}

function Property({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function ActivityFeed({
  activity,
  agents,
  workspace,
  onOpenAgent,
  onEdit,
  onDelete,
}: {
  activity: TicketActivity[];
  agents: Agent[];
  workspace?: Workspace;
  onOpenAgent: (handle: string) => void;
  onEdit: (commentId: string, body: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}) {
  if (activity.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing has happened yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-4">
      {activity.map((entry) => entry.kind === "comment" && entry.body ? (
        <CommentActivity
          key={entry.id}
          entry={entry}
          agents={agents}
          workspace={workspace}
          onOpenAgent={onOpenAgent}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ) : (
        <li key={entry.id}>
          <Marker>
            <MarkerIcon className="flex h-4 w-8 items-center justify-center">
              {activityIcon(entry)}
            </MarkerIcon>
            <MarkerContent className="flex items-baseline gap-1.5">
              <span className="text-foreground">{actorName(entry.actor, agents)}</span>
              <span>{describe(entry)}</span>
              <time className="ml-auto shrink-0 text-xs" dateTime={new Date(entry.at).toISOString()}>
                {when(entry.at)}
              </time>
            </MarkerContent>
          </Marker>
        </li>
      ))}
    </ol>
  );
}

function CommentActivity({
  entry,
  agents,
  workspace,
  onOpenAgent,
  onEdit,
  onDelete,
}: {
  entry: TicketActivity;
  agents: Agent[];
  workspace?: Workspace;
  onOpenAgent: (handle: string) => void;
  onEdit: (commentId: string, body: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.body ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const roster = useMemo(() => people(agents), [agents]);
  const own = entry.actor === YOU;

  useEffect(() => setDraft(entry.body ?? ""), [entry.body]);

  const save = async () => {
    const body = draft.trim();
    if (!body || body === entry.body) {
      setEditing(false);
      setDraft(entry.body ?? "");
      return;
    }
    setSaving(true);
    try {
      await onEdit(entry.id, body);
      setEditing(false);
    } catch {
      // The toast above keeps the editor open with the text intact.
    } finally {
      setSaving(false);
    }
  };

  return (
    <li>
      <Message>
        <MessageAvatar className="self-start bg-transparent">
          <AssigneeAvatar
            assignee={activityActorId(entry.actor, agents)}
            agents={agents}
            workspace={workspace}
            size="md"
          />
        </MessageAvatar>
        <MessageContent className="gap-1.5">
          <MessageHeader className="gap-1.5 px-0">
            <span className="truncate text-foreground">{actorName(entry.actor, agents)}</span>
            <time className="shrink-0" dateTime={new Date(entry.at).toISOString()}>{when(entry.at)}</time>
            {entry.editedAt && <span>Edited</span>}
            {own && !editing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="ml-auto" variant="ghost" size="icon-xs" aria-label="Comment actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuItem onSelect={() => setEditing(true)}>
                      <Pencil />
                      Edit comment
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                      <Trash2 />
                      Delete comment
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </MessageHeader>
          <Bubble variant="muted" className="w-full max-w-full">
            <BubbleContent className="w-full">
              {editing ? (
                <div className="flex flex-col gap-2">
                  <MentionField
                    rows={3}
                    value={draft}
                    onChange={setDraft}
                    people={roster}
                    agents={agents}
                    onSubmit={() => void save()}
                    aria-label="Edit comment"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={saving}
                      onClick={() => {
                        setEditing(false);
                        setDraft(entry.body ?? "");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button size="xs" disabled={!draft.trim() || saving} onClick={() => void save()}>
                      Save comment
                    </Button>
                  </div>
                </div>
              ) : (
                <Markdown text={entry.body ?? ""} mentions={named(entry, agents, onOpenAgent)} />
              )}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>This removes your comment from this ticket.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                setDeleting(true);
                void onDelete(entry.id)
                  .then(() => setDeleteOpen(false))
                  .catch(() => {})
                  .finally(() => setDeleting(false));
              }}
            >
              Delete comment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function activityActorId(actor: string, agents: Agent[]): string | undefined {
  if (actor === YOU || actor === WORKSPACE_AGENT) return actor;
  return agents.find((agent) => agent.id === actor || agent.handle === actor)?.id;
}

function activityIcon(entry: TicketActivity) {
  if (entry.kind === "status" && typeof entry.detail?.status === "string") {
    return <StatusIcon status={entry.detail.status as TicketStatus} decorative />;
  }
  if (entry.kind === "create") return <CirclePlus />;
  if (entry.kind === "link") return <Link2 />;
  if (entry.kind === "unlink") return <Link2Off />;
  if (entry.kind === "handoff") return <MessagesSquare />;
  if (entry.kind === "field") return <Pencil />;
  return <MessageSquare />;
}

/// What the entry's `@` tokens should render as now.
///
/// The stored handle says what text is in the prose; the stored id says who
/// that was. So an agent renamed after the fact still renders under its
/// current name, and a mention of somebody since deleted quietly stays plain
/// text rather than pointing at nothing.
function named(entry: TicketActivity, agents: Agent[], onOpenAgent: (handle: string) => void): Mention[] {
  return (entry.mentions ?? []).flatMap((mention) => {
    if (mention.id === YOU) return [{ handle: mention.handle, label: "You" }];
    // The workspace agent has no pane of its own to open: it is the workspace's
    // own model rather than a roster entry.
    if (mention.id === WORKSPACE_AGENT) return [{ handle: mention.handle, label: "Workspace agent" }];
    const agent = agents.find((candidate) => candidate.id === mention.id);
    return agent
      ? [{ handle: mention.handle, label: agent.name, onOpen: () => onOpenAgent(agent.handle) }]
      : [];
  });
}

function actorName(actor: string, agents: Agent[]): string {
  if (actor === "you") return "You";
  if (actor === "remy") return "Remy";
  if (actor === WORKSPACE_AGENT) return "Workspace agent";
  return agents.find((agent) => agent.id === actor || agent.handle === actor)?.name ?? actor;
}

function describe(entry: TicketActivity): string {
  const status = typeof entry.detail?.status === "string" ? entry.detail.status : undefined;
  if (entry.kind === "create") return "created this ticket";
  if (entry.kind === "comment") return "commented";
  if (entry.kind === "link") return "attached a thread";
  if (entry.kind === "unlink") return "detached a thread";
  if (entry.kind === "handoff") return "handed this on";
  if (entry.kind === "status" && status) {
    return `moved this to ${STATUS_LABEL[status as TicketStatus] ?? status}`;
  }
  return "changed this ticket";
}

function when(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const date = new Date(at);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

function CommentBox({
  agents,
  onSend,
}: {
  agents: Agent[];
  onSend: (body: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const roster = useMemo(() => people(agents), [agents]);

  const send = async () => {
    const body = value.trim();
    if (!body) return;
    setSending(true);
    try {
      await onSend(body);
      setValue("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <MentionField
        rows={3}
        value={value}
        onChange={setValue}
        people={roster}
        agents={agents}
        onSubmit={() => void send()}
        placeholder="Write a comment. @ names an agent or you."
      />
      <Button size="sm" className="self-end" disabled={!value.trim() || sending} onClick={() => void send()}>
        <Send />
        Add comment
      </Button>
    </div>
  );
}

/// Attaching a thread that already exists. Deliberately does not start or
/// resume it — this is bookkeeping, and the thread carries on as it was.
function AttachThreadDialog({
  open,
  onOpenChange,
  ticket,
  onAttached,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticket: Ticket;
  onAttached: () => void;
}) {
  const chats = useStore(useShallow((s) => open ? s.chats : []));
  const tickets = useStore((s) => s.tickets);
  const attachThread = useStore((s) => s.attachThread);

  // A thread belongs to one ticket at a time, so the ones already spoken for
  // are not offered rather than offered and refused.
  const taken = new Set(tickets.flatMap((entry) => entry.threads.map((link) => link.chatId)));
  const available = chats.filter((chat) => !taken.has(chat.id));

  const attach = async (chatId: string) => {
    try {
      await attachThread(ticket.id, chatId);
      onOpenChange(false);
      onAttached();
    } catch (error) {
      toast.error("Couldn't attach that thread", { description: apiError(error) });
    }
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Attach a thread">
      <Command>
        <CommandInput placeholder="Find a thread…" />
        <CommandList>
          <CommandEmpty>
            {chats.length === 0 ? "No threads on this machine yet." : "Every thread is already on a ticket."}
          </CommandEmpty>
          {available.map((chat) => (
            <CommandItem key={chat.id} value={`${chat.title} ${chat.cwd}`} onSelect={() => void attach(chat.id)}>
              <MessagesSquare />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{chat.title}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">{chat.cwd}</span>
              </span>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

/// Shown when a route names a ticket that is not here — a stale link, or one
/// from a machine this device cannot reach.
export function MissingTicket({ ticketKey, onBack }: { ticketKey: string; onBack: () => void }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <PaneHeader crumbs={[{ label: "Tasks", onClick: onBack }, { label: ticketKey }]} />
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessagesSquare />
          </EmptyMedia>
          <EmptyTitle>No ticket called {ticketKey}</EmptyTitle>
          <EmptyDescription>It was deleted, or it lives on a machine you can't reach.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </main>
  );
}
