import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { KanbanSquare, Plus, SquareKanban } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PaneHeader } from "@/components/PaneHeader";
import { ProjectScope, chosenPrefixes, scopedProjects } from "@/components/ProjectScope";
import { deviceIcon } from "@/lib/devices";
import { localWorkspace } from "@/lib/projects";
import { AssigneeAvatar, StatusIcon, SubTicketProgress } from "@/components/TicketGlyphs";
import { apiError } from "@/lib/api-error";
import {
  BOARD_COLUMNS,
  STATUS_LABEL,
  TICKET_STATUSES,
  currentThread,
  deviceForTicket,
  neighboursAt,
  shortDate,
  subTicketProgress,
  ticketsInColumn,
  topLevel,
} from "@/lib/tickets";
import { cn } from "@/lib/utils";
import { useStore } from "@/state/store";
import type { Agent, Chat, Project, Server, Ticket, TicketStatus, Workspace } from "@/state/types";

const DONE_PREVIEW_COUNT = 5;

/// The board: one column per status, cards in rank order.
///
/// Every project at once by default — work does not arrive one repository at a
/// time — with a filter for narrowing it. The filter lives in the URL as the
/// key prefixes it kept, so `#/board/REMY,ATLAS` is a view you can send someone.
///
/// Cards drag between columns and also move by menu. The menu is not a fallback:
/// it is the keyboard path, and both call the same move.

export function Board({
  scope,
  onScope,
  onOpenTicket,
  onAddWorkspace,
}: {
  /// Comma-joined key prefixes from the URL. Empty means every project.
  scope?: string;
  onScope: (scope?: string) => void;
  onOpenTicket: (key: string) => void;
  onAddWorkspace: () => void;
}) {
  const projects = useStore((s) => s.projects);
  const tickets = useStore((s) => s.tickets);
  const agents = useStore((s) => s.agents);
  const chats = useStore((s) => s.chats);
  const workspaces = useStore((s) => s.workspaces);
  const servers = useStore((s) => s.servers);
  const boardDevices = useStore((s) => s.boardDevices);
  const loading = useStore((s) => s.boardLoading);
  const loadBoard = useStore((s) => s.loadBoard);
  const moveTicket = useStore((s) => s.moveTicket);
  const [composing, setComposing] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [dragging, setDragging] = useState<Ticket | undefined>();

  useEffect(() => {
    void loadBoard().catch(() => {
      // An unreachable machine already says so in the device badge.
    });
  }, [loadBoard]);

  const chosen = useMemo(() => chosenPrefixes(scope), [scope]);
  const shown = useMemo(() => scopedProjects(projects, chosen), [projects, chosen]);
  const scoped = useMemo(() => {
    const ids = new Set(shown.map((project) => project.id));
    return tickets.filter((ticket) => ids.has(ticket.projectId));
  }, [tickets, shown]);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking a card to open
    // it is not read as the beginning of one.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const onDragEnd = async (event: DragEndEvent) => {
    setDragging(undefined);
    const ticket = scoped.find((entry) => entry.id === event.active.id);
    const status = event.over?.id as TicketStatus | undefined;
    if (!ticket || !status || !BOARD_COLUMNS.includes(status) || status === ticket.status) return;
    const { before, after } = neighboursAt(scoped, status, 0, ticket.id);
    try {
      await moveTicket(ticket.id, status, before, after);
    } catch (error) {
      toast.error("Couldn't move that ticket", { description: apiError(error) });
    }
  };

  if (projects.length === 0) {
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <PaneHeader crumbs={[{ label: "Tasks" }]} />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SquareKanban />
            </EmptyMedia>
            <EmptyTitle className={loading ? "shimmer" : undefined}>
              {loading ? "Reading the board…" : "No workspaces yet"}
            </EmptyTitle>
            <EmptyDescription>
              {loading ? "Asking this machine what it is tracking." : "Add a workspace to plan work in it."}
            </EmptyDescription>
          </EmptyHeader>
          {!loading && (
            <EmptyContent>
              <Button onClick={onAddWorkspace}>
                <Plus />
                Add workspace
              </Button>
            </EmptyContent>
          )}
        </Empty>
      </main>
    );
  }

  const open = topLevel(scoped).length;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <PaneHeader crumbs={[{ label: "Tasks" }]}>
        <span className="text-xs text-muted-foreground tabular-nums">
          {open} ticket{open === 1 ? "" : "s"}
        </span>
        <ProjectScope
          projects={projects}
          shown={shown}
          workspaces={workspaces}
          scope={scope}
          onScope={onScope}
        />
        <Button size="sm" onClick={() => setComposing(true)}>
          <Plus />
          New ticket
        </Button>
      </PaneHeader>

      {open === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KanbanSquare />
            </EmptyMedia>
            <EmptyTitle>Nothing on the board</EmptyTitle>
            <EmptyDescription>
              {chosen.size === 0 ? "Write the first ticket." : "No tickets in the workspaces you picked."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setComposing(true)}>
              <Plus />
              New ticket
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={(event: DragStartEvent) =>
            setDragging(scoped.find((entry) => entry.id === event.active.id))
          }
          onDragCancel={() => setDragging(undefined)}
          onDragEnd={(event) => void onDragEnd(event)}
        >
          <ScrollArea className="min-h-0 flex-1" orientation="both">
            <div className="flex min-h-full items-start gap-3 p-4">
              {BOARD_COLUMNS.map((status) => (
                <Column
                  key={status}
                  status={status}
                  tickets={ticketsInColumn(scoped, status)}
                  allTickets={scoped}
                  agents={agents}
                  chats={chats}
                  projects={projects}
                  workspaces={workspaces}
                  onOpenTicket={onOpenTicket}
                  onViewAllDone={() => setDoneOpen(true)}
                />
              ))}
            </div>
          </ScrollArea>
          <DragOverlay dropAnimation={null}>
            {dragging && (
              <CardBody
                ticket={dragging}
                agents={agents}
                thread={currentThread(chats, dragging)}
                device={deviceForTicket(dragging, boardDevices, servers)}
                workspace={workspaceForTicket(dragging, projects, workspaces)}
                progress={subTicketProgress(scoped, dragging)}
                className="rotate-1 shadow-lg"
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      <NewTicketDialog
        open={composing}
        onOpenChange={setComposing}
        projects={projects}
        projectId={shown[0]?.id}
        onCreated={onOpenTicket}
      />
      <DoneTicketsDialog
        open={doneOpen}
        onOpenChange={setDoneOpen}
        tickets={ticketsInColumn(scoped, "done")}
        agents={agents}
        projects={projects}
        workspaces={workspaces}
        servers={servers}
        boardDevices={boardDevices}
        onOpenTicket={onOpenTicket}
      />
    </main>
  );
}

function Column({
  status,
  tickets,
  allTickets,
  agents,
  chats,
  projects,
  workspaces,
  onOpenTicket,
  onViewAllDone,
}: {
  status: TicketStatus;
  tickets: Ticket[];
  allTickets: Ticket[];
  agents: Agent[];
  chats: Chat[];
  projects: Project[];
  workspaces: Workspace[];
  onOpenTicket: (key: string) => void;
  onViewAllDone: () => void;
}) {
  const servers = useStore((s) => s.servers);
  const boardDevices = useStore((s) => s.boardDevices);
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const shown = status === "done" ? tickets.slice(0, DONE_PREVIEW_COUNT) : tickets;

  return (
    <section className="flex w-[19rem] shrink-0 flex-col gap-2" aria-label={STATUS_LABEL[status]} data-status={status}>
      <header className="flex items-center gap-2 px-1">
        <StatusIcon status={status} decorative />
        <h2 className="text-sm font-medium">{STATUS_LABEL[status]}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{tickets.length}</span>
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-24 flex-col gap-2 rounded-lg transition-colors",
          isOver && "bg-accent/60 ring-1 ring-primary/40",
        )}
      >
        {shown.map((ticket) => (
          <TicketCard
            key={ticket.id}
            ticket={ticket}
            allTickets={allTickets}
            agents={agents}
            thread={currentThread(chats, ticket)}
            device={deviceForTicket(ticket, boardDevices, servers)}
            workspace={workspaceForTicket(ticket, projects, workspaces)}
            onOpen={() => onOpenTicket(ticket.key)}
          />
        ))}
        {status === "done" && tickets.length > shown.length ? (
          <Button type="button" variant="ghost" size="sm" onClick={onViewAllDone}>
            View all {tickets.length}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function DoneTicketsDialog({
  open,
  onOpenChange,
  tickets,
  agents,
  projects,
  workspaces,
  servers,
  boardDevices,
  onOpenTicket,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tickets: Ticket[];
  agents: Agent[];
  projects: Project[];
  workspaces: Workspace[];
  servers: Server[];
  boardDevices: { deviceId: string; serverId: string }[];
  onOpenTicket: (key: string) => void;
}) {
  const openTicket = (key: string) => {
    onOpenChange(false);
    onOpenTicket(key);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Done tickets</DialogTitle>
          <DialogDescription>All finished tickets in the workspaces you picked.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <ItemGroup className="gap-1 pr-3">
            {tickets.map((ticket) => {
              const workspace = workspaceForTicket(ticket, projects, workspaces);
              const device = deviceForTicket(ticket, boardDevices, servers);
              const DeviceIcon = deviceIcon(device?.icon);
              return (
                <Item key={ticket.id} asChild variant="outline" size="sm">
                  <button type="button" data-link className="w-full text-left" onClick={() => openTicket(ticket.key)}>
                    <ItemMedia>
                      <StatusIcon status="done" decorative />
                    </ItemMedia>
                    <ItemContent className="min-w-0 gap-0.5">
                      <ItemTitle className="w-full min-w-0">
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{ticket.key}</span>
                        <span className="truncate">{ticket.title}</span>
                      </ItemTitle>
                      <ItemDescription className="text-xs">
                        Finished {shortDate(ticket.closedAt ?? ticket.updatedAt)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <AssigneeAvatar assignee={ticket.assigneeAgentId} agents={agents} workspace={workspace} />
                      {device ? <DeviceIcon aria-label={device.name} /> : null}
                    </ItemActions>
                  </button>
                </Item>
              );
            })}
          </ItemGroup>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/// The card itself, split from the draggable wrapper so the drag overlay can
/// render exactly the same thing without a second set of styles.
function CardBody({
  ticket,
  agents,
  thread,
  device,
  workspace,
  progress,
  className,
}: {
  ticket: Ticket;
  agents: Agent[];
  thread?: Chat;
  device?: Server;
  workspace?: Workspace;
  progress: { done: number; total: number };
  className?: string;
}) {
  const DeviceIcon = deviceIcon(device?.icon);
  return (
    <div
      className={cn(
        "flex w-[19rem] flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-left",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {/* The key already carries the project's slug, so naming the project
            again beside it is the same word twice. */}
        <span className="font-mono text-[11px] text-muted-foreground">{ticket.key}</span>
        {thread && thread.state !== "idle" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  thread.state === "needs_input" && "bg-warning",
                  thread.state === "working" && "bg-info",
                  thread.state === "error" && "bg-destructive",
                )}
              />
            </TooltipTrigger>
            <TooltipContent>
              {thread.state === "needs_input" ? "Its thread needs you" : "Its thread is working"}
            </TooltipContent>
          </Tooltip>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <AssigneeAvatar
            assignee={ticket.assigneeAgentId}
            agents={agents}
            workspace={workspace}
          />
        </span>
      </div>

      <div className="flex items-start gap-2">
        <span className="pt-0.5">
          <StatusIcon status={ticket.status} />
        </span>
        <p className="line-clamp-3 text-sm leading-snug">{ticket.title}</p>
      </div>

      {progress.total > 0 && (
        <div className="flex items-center gap-2 pl-[1.375rem]">
          <SubTicketProgress done={progress.done} total={progress.total} />
        </div>
      )}

      <div className="flex items-center gap-2 pl-[1.375rem] text-[11px] text-muted-foreground">
        <span>Created {shortDate(ticket.createdAt)}</span>
        {device && (
          // Which machine would pick this up. On a one-machine board it is the
          // same answer every time; that is still the answer.
          <span className="ml-auto flex min-w-0 shrink items-center gap-1">
            <DeviceIcon className="size-3 shrink-0" />
            <span className="truncate">{device.name}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  allTickets,
  agents,
  thread,
  device,
  workspace,
  onOpen,
}: {
  ticket: Ticket;
  allTickets: Ticket[];
  agents: Agent[];
  thread?: Chat;
  device?: Server;
  workspace?: Workspace;
  onOpen: () => void;
}) {
  const moveTicket = useStore((s) => s.moveTicket);
  const deleteTicket = useStore((s) => s.deleteTicket);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: ticket.id });

  const move = async (next: TicketStatus) => {
    if (next === ticket.status) return;
    // Landing at the top of the target column is what a person means by "move
    // this to In progress" — they are choosing a column, not a position.
    const { before, after } = neighboursAt(allTickets, next, 0, ticket.id);
    try {
      await moveTicket(ticket.id, next, before, after);
    } catch (error) {
      toast.error("Couldn't move that ticket", { description: apiError(error) });
    }
  };

  const remove = async () => {
    try {
      await deleteTicket(ticket.id);
      toast.success(`${ticket.key} deleted`);
    } catch (error) {
      toast.error("Couldn't delete that ticket", { description: apiError(error) });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          // dnd-kit supplies role, tabIndex and the screen-reader instructions
          // for picking a card up, so they are spread on rather than repeated.
          {...attributes}
          {...listeners}
          aria-label={`${ticket.key} ${ticket.title}`}
          style={{ transform: CSS.Translate.toString(transform) }}
          onClick={onOpen}
          onKeyDown={(event) => {
            // Space is the drag handle's own key, so only Enter opens.
            if (event.key !== "Enter") return;
            event.preventDefault();
            onOpen();
          }}
          className={cn(
            "rounded-lg hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            isDragging && "opacity-40",
          )}
        >
          <CardBody
            ticket={ticket}
            agents={agents}
            thread={thread}
            device={device}
            workspace={workspace}
            progress={subTicketProgress(allTickets, ticket)}
            className="bg-transparent hover:bg-transparent"
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>Open ticket</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {TICKET_STATUSES.filter((status) => status !== ticket.status).map((status) => (
              <ContextMenuItem key={status} onSelect={() => void move(status)}>
                <StatusIcon status={status} decorative />
                {STATUS_LABEL[status]}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => void remove()}>
          Delete ticket
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function workspaceForTicket(ticket: Ticket, projects: Project[], workspaces: Workspace[]): Workspace | undefined {
  const project = projects.find((entry) => entry.id === ticket.projectId);
  return project ? localWorkspace(project, workspaces) : undefined;
}

export function NewTicketDialog({
  open,
  onOpenChange,
  projects,
  projectId,
  parentId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  projectId?: string;
  /// Set when the ticket being written is a sub-ticket of another.
  parentId?: string;
  onCreated: (key: string) => void;
}) {
  const createTicket = useStore((s) => s.createTicket);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [project, setProject] = useState(projectId ?? projects[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBody("");
    setProject(projectId ?? projects[0]?.id ?? "");
  }, [open, projectId, projects]);

  const submit = async () => {
    if (!title.trim() || !project) return;
    setSaving(true);
    try {
      const ticket = await createTicket({
        projectId: project,
        title: title.trim(),
        body,
        ...(parentId ? { parentId } : {}),
      });
      onOpenChange(false);
      onCreated(ticket.key);
    } catch (error) {
      toast.error("Couldn't create that ticket", { description: apiError(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parentId ? "New sub-ticket" : "New ticket"}</DialogTitle>
          <DialogDescription>Name the work. You can assign it once it exists.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="ticket-title">Title</FieldLabel>
            <Input
              id="ticket-title"
              autoFocus
              value={title}
              placeholder="Flaky login test"
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void submit();
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ticket-body">Description</FieldLabel>
            <Textarea
              id="ticket-body"
              rows={5}
              value={body}
              placeholder="What has to change, and how you will know it worked."
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
          {projects.length > 1 && !parentId && (
            <Field orientation="horizontal" className="items-center">
              <FieldContent>
                <FieldLabel htmlFor="ticket-workspace">Workspace</FieldLabel>
              </FieldContent>
              <Select value={project} onValueChange={setProject}>
                <SelectTrigger id="ticket-workspace" size="sm" className="w-52 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectGroup>
                    {projects.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!title.trim() || !project || saving}>
            Create ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
