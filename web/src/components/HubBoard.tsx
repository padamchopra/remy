import { usePersonalHub } from "@/lib/hub-scope";
import type { LinearBoardState } from "./HubLinearBoard";
import { Checkbox } from "@/components/ui/checkbox";
import { useEffect, useState } from "react";
import { Circle, Folder, Monitor, User } from "lucide-react";
import type { BoardProjection, HubThread } from "@remy/contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";
import { watchHubResource } from "@/lib/hub-computers";
import { hubRequest, hubThreadBase, watchHubThreads } from "@/lib/hub-threads";
import { apiError } from "@/lib/api-error";
import { useHubResource, type HubWorkspace } from "@/lib/hub-organization";
import type { Route } from "@/lib/route";
const statuses = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  needs_input: "Needs input",
  pr_review: "PR review",
  done: "Done",
  cancelled: "Cancelled",
};
export default function HubBoard({
  organizationId,
  ticketId,
  navigate,
}: {
  organizationId: string;
  ticketId?: string;
  navigate: (route: Route) => void;
}) {
  const isPersonal = usePersonalHub();
  const [items, setItems] = useState<BoardProjection[]>([]);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<BoardProjection | "new">();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [workspace, setWorkspace] = useState("none");
  const [ticketStatus, setTicketStatus] = useState("todo"),
    [parent, setParent] = useState("none"),
    [assignee, setAssignee] = useState("none"),
    [labels, setLabels] = useState<{ id: string; name: string }[]>([]),
    [comment, setComment] = useState("");
  const linear = useHubResource<LinearBoardState>(
    organizationId,
    "/linear-board",
  );
  const members = useHubResource<{
    members: { userId: string; name: string }[];
  }>(organizationId, "/members");
  const agents = useHubResource<{
    agents: { id: string; fields: Record<string, unknown> }[];
  }>(organizationId, "/agents", "/board/live");
  const [busy, setBusy] = useState(false);
  const [threads, setThreads] = useState<HubThread[]>([]);
  const workspaces = useHubResource<{ workspaces: HubWorkspace[] }>(
    organizationId,
    "/workspaces",
  );
  const base = hubThreadBase(organizationId);
  useEffect(() => {
    setItems([]);
    setLoaded(false);
    return watchHubResource<{ items: BoardProjection[] }>(
      `${base}/board/tickets`,
      (value, outdated) => {
        setItems(value?.items ?? []);
        setStale(outdated);
        setLoaded(true);
        if (!outdated) setError("");
      },
      setError,
      `${base}/board/live`,
    );
  }, [base]);
  useEffect(
    () => watchHubThreads(organizationId, setThreads, setError),
    [organizationId],
  );
  useEffect(() => {
    setEditing(undefined);
  }, [organizationId]);
  const openEdit = (item: BoardProjection | "new") => {
    setEditing(item);
    setTicketStatus(
      item === "new" ? "todo" : String(item.fields.status ?? "todo"),
    );
    setParent(item === "new" ? "none" : String(item.fields.parentId ?? "none"));
    setLabels(
      item === "new"
        ? []
        : Array.isArray(item.fields.labels)
          ? (item.fields.labels as { id: string; name: string }[])
          : [],
    );
    setAssignee(
      item === "new"
        ? "none"
        : item.fields.assigneeAgentId &&
            !["you", "workspace"].includes(String(item.fields.assigneeAgentId))
          ? `agent:${item.fields.assigneeAgentId}`
          : item.fields.assigneeMemberId
            ? `member:${item.fields.assigneeMemberId}`
            : item.fields.assigneeName
              ? "unknown"
              : "none",
    );
    setTitle(item === "new" ? "" : String(item.fields.title));
    setBody(item === "new" ? "" : String(item.fields.body ?? ""));
    setWorkspace(
      item === "new" ? "none" : String(item.fields.projectId || "none"),
    );
  };
  const append = async (
    item: BoardProjection,
    kind: string,
    payload: Record<string, unknown>,
  ) => {
    setBusy(true);
    setError("");
    try {
      await hubRequest(`${base}/board/events`, "POST", {
        entity: "ticket",
        entityId: item.id,
        kind,
        payload,
      });
      return true;
    } catch (e) {
      setError(apiError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const ticket = items.find(
    (item) =>
      item.id === ticketId ||
      `${item.fields.keyPrefix ?? "WRK"}-${item.fields.number}` === ticketId,
  );
  const renderCard = (item: BoardProjection) => (
    <Card key={item.id}>
      <CardHeader>
        <CardTitle>
          <Button
            variant="link"
            className="h-auto justify-start whitespace-normal p-0 text-left"
            data-link
            onClick={() =>
              navigate({ name: "ticket", key: item.id, organizationId })
            }
          >
            <Circle data-icon="inline-start" />
            {item.fields.keyPrefix
              ? `${item.fields.keyPrefix}-${item.fields.number} · `
              : ""}
            {String(item.fields.title)}
          </Button>
        </CardTitle>
        <CardDescription className="flex items-center gap-1">
          <User />
          {item.lastActor.label}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Select
          value={String(item.fields.status ?? "backlog")}
          disabled={busy || stale}
          onValueChange={(status) => void append(item, "status", { status })}
        >
          <SelectTrigger aria-label={`Status for ${item.fields.title}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {Object.entries(statuses).map(([key, label]) => (
                <SelectItem value={key} key={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto p-6"
      aria-label="Tasks"
    >
      <header className="flex items-center justify-between gap-2">
        <h1>Tasks</h1>
        <Button disabled={stale} onClick={() => openEdit("new")}>
          Create ticket
        </Button>
      </header>
      {error && <p role="alert">{error}</p>}
      {stale && (
        <p role="status">
          You’re reading the last saved Tasks; reconnect to make changes.
        </p>
      )}
      {!loaded ? (
        <p role="status">Reading your Tasks…</p>
      ) : ticketId ? (
        ticket ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{String(ticket.fields.title)}</CardTitle>
                <CardDescription>
                  {ticket.fields.keyPrefix
                    ? `${ticket.fields.keyPrefix}-${ticket.fields.number} · `
                    : ""}
                  Updated by {ticket.lastActor.label}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="whitespace-pre-wrap break-words">
                  {String(ticket.fields.body ?? "")}
                </p>
                {!!ticket.fields.externalUrl && (
                  <Button asChild variant="link">
                    <a
                      href={String(ticket.fields.externalUrl)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Linear
                    </a>
                  </Button>
                )}
                {!!ticket.fields.assigneeName && (
                  <p>Assigned to {String(ticket.fields.assigneeName)}</p>
                )}
                {Array.isArray(ticket.fields.labels) && (
                  <p className="text-sm text-muted-foreground">
                    {(ticket.fields.labels as { name: string }[])
                      .map((l) => l.name)
                      .join(" · ")}
                  </p>
                )}
                {!!ticket.fields.parentId && (
                  <Button
                    variant="link"
                    data-link
                    onClick={() =>
                      navigate({
                        name: "ticket",
                        key: String(ticket.fields.parentId),
                        organizationId,
                      })
                    }
                  >
                    Open parent ticket
                  </Button>
                )}
                {items
                  .filter((child) => child.fields.parentId === ticket.id)
                  .map((child) => (
                    <Button
                      key={child.id}
                      variant="link"
                      data-link
                      onClick={() =>
                        navigate({
                          name: "ticket",
                          key: child.id,
                          organizationId,
                        })
                      }
                    >
                      {String(child.fields.title)}
                    </Button>
                  ))}
                <Button
                  variant="outline"
                  disabled={stale}
                  onClick={() => openEdit(ticket)}
                >
                  Edit ticket
                </Button>
                {workspaces.value?.workspaces
                  .filter((w) => w.id === ticket.fields.projectId)
                  .map((w) => (
                    <Button
                      key={w.id}
                      variant="link"
                      data-link
                      onClick={() =>
                        navigate({
                          name: "workspaces",
                          workspaceId: w.id,
                          organizationId,
                        })
                      }
                    >
                      <Folder data-icon="inline-start" />
                      {w.name}
                    </Button>
                  ))}
                {(Array.isArray(ticket.fields.threads)
                  ? (ticket.fields.threads as {
                      chatId: string;
                      computerId: string;
                    }[])
                  : []
                ).map((link) => {
                  const thread = threads.find(
                    (t) =>
                      t.id === link.chatId && t.computerId === link.computerId,
                  );
                  return thread ? (
                    <Button
                      key={`${link.computerId}:${link.chatId}`}
                      variant="link"
                      data-link
                      onClick={() =>
                        navigate({
                          name: "threads",
                          organizationId,
                          computerId: link.computerId,
                          threadId: link.chatId,
                        })
                      }
                    >
                      <Monitor data-icon="inline-start" />
                      {thread.detail.title}
                    </Button>
                  ) : (
                    <p key={`${link.computerId}:${link.chatId}`}>
                      This thread is unavailable.
                    </p>
                  );
                })}
              </CardContent>
            </Card>
            {renderCard(ticket)}
            <Card>
              <CardHeader>
                <CardTitle>Comments</CardTitle>
              </CardHeader>
              <CardContent className="flex min-w-0 flex-col gap-3">
                {ticket.activity
                  .filter((a) => a.kind === "comment")
                  .map((a) => (
                    <div
                      key={a.eventId}
                      className="min-w-0 rounded-md border p-3"
                    >
                      <p className="text-sm text-muted-foreground">
                        {a.actor.label}
                        {(a.payload.source as { provider?: string } | undefined)
                          ?.provider === "linear"
                          ? " · Linear"
                          : ""}
                      </p>
                      <p className="whitespace-pre-wrap break-words">
                        {String(a.payload.text ?? a.payload.body ?? "")}
                      </p>
                    </div>
                  ))}
                <Textarea
                  aria-label="Ticket comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Write a comment"
                />
                <Button
                  disabled={busy || stale || !comment.trim()}
                  onClick={() =>
                    void append(ticket, "comment", { text: comment }).then(
                      (ok) => {
                        if (ok) setComment("");
                      },
                    )
                  }
                >
                  Post comment
                </Button>
              </CardContent>
            </Card>
          </>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>This ticket is unavailable</EmptyTitle>
              <EmptyDescription>
                Ask a workspace member to check your access.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      ) : items.length ? (
        <div className="flex min-w-0 flex-col gap-4 overflow-x-auto md:flex-row">
          {Object.entries(statuses)
            .filter(([status]) =>
              items.some(
                (item) => String(item.fields.status ?? "backlog") === status,
              ),
            )
            .map(([status, label]) => (
              <section
                key={status}
                className="flex min-w-64 flex-1 flex-col gap-3"
                aria-label={label}
              >
                <h2 className="text-sm text-muted-foreground">{label}</h2>
                {items
                  .filter(
                    (item) =>
                      String(item.fields.status ?? "backlog") === status,
                  )
                  .map(renderCard)}
              </section>
            ))}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No tickets yet</EmptyTitle>
            <EmptyDescription>
              Create a ticket to plan your next piece of work.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => openEdit("new")}>Create ticket</Button>
          </EmptyContent>
        </Empty>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(undefined);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? "Create ticket" : "Edit ticket"}
            </DialogTitle>
            <DialogDescription>
              Describe the work you want to do.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!editing) return;
              setBusy(true);
              setError("");
              void hubRequest(`${base}/board/events`, "POST", {
                entity: "ticket",
                entityId: editing === "new" ? crypto.randomUUID() : editing.id,
                kind: editing === "new" ? "create" : "field",
                payload: {
                  title,
                  body,
                  status: ticketStatus,
                  parentId: parent === "none" ? null : parent,
                  labels,
                  ...(assignee === "unknown"
                    ? {}
                    : {
                        assigneeAgentId: assignee.startsWith("agent:")
                          ? assignee.slice(6)
                          : "you",
                        assigneeMemberId: assignee.startsWith("member:")
                          ? assignee.slice(7)
                          : null,
                        assigneeName: assignee.startsWith("member:")
                          ? (members.value?.members.find(
                              (m) => m.userId === assignee.slice(7),
                            )?.name ?? null)
                          : assignee.startsWith("agent:")
                            ? String(
                                agents.value?.agents.find(
                                  (a) => a.id === assignee.slice(6),
                                )?.fields.name ?? "Agent",
                              )
                            : null,
                      }),
                  projectId: workspace === "none" ? "" : workspace,
                },
              })
                .then(() => setEditing(undefined))
                .catch((e) => setError(apiError(e)))
                .finally(() => setBusy(false));
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="ticket-title">Title</FieldLabel>
                <Input
                  id="ticket-title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="ticket-body">Description</FieldLabel>
                <Textarea
                  id="ticket-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Workspace</FieldLabel>
                <Select value={workspace} onValueChange={setWorkspace}>
                  <SelectTrigger aria-label="Ticket workspace">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="none">{isPersonal ? "No workspace" : "Organization"}</SelectItem>
                      {workspaces.value?.workspaces.map((w) => (
                        <SelectItem value={w.id} key={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={ticketStatus} onValueChange={setTicketStatus}>
                  <SelectTrigger aria-label="Ticket status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statuses).map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Parent ticket</FieldLabel>
                <Select value={parent} onValueChange={setParent}>
                  <SelectTrigger aria-label="Parent ticket">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No parent</SelectItem>
                    {items
                      .filter(
                        (t) =>
                          t.fields.projectId === workspace &&
                          (editing === "new" || t.id !== editing?.id),
                      )
                      .map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {String(t.fields.title)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Assignee</FieldLabel>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger aria-label="Ticket assignee">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {assignee === "unknown" && (
                      <SelectItem value="unknown">
                        Keep unmatched assignee
                      </SelectItem>
                    )}
                    {members.value?.members.map((m) => (
                      <SelectItem key={m.userId} value={`member:${m.userId}`}>
                        {m.name}
                      </SelectItem>
                    ))}
                    {agents.value?.agents
                      .filter((a) => a.fields.scope !== "personal")
                      .map((a) => (
                        <SelectItem key={a.id} value={`agent:${a.id}`}>
                          {String(a.fields.name)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
              {!!linear.value?.labels[workspace]?.length && (
                <Field>
                  <FieldLabel>Labels</FieldLabel>
                  {linear.value.labels[workspace].map((label) => (
                    <label key={label.id} className="flex items-center gap-2">
                      <Checkbox
                        checked={labels.some((l) => l.id === label.id)}
                        onCheckedChange={(checked) =>
                          setLabels((old) =>
                            checked
                              ? [...old, label]
                              : old.filter((l) => l.id !== label.id),
                          )
                        }
                      />
                      {label.name}
                    </label>
                  ))}
                </Field>
              )}
              {error && <p role="alert">{error}</p>}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(undefined)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !title.trim() || stale}>
                  Save ticket
                </Button>
              </DialogFooter>
            </FieldGroup>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
