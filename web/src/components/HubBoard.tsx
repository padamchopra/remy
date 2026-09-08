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
  const [items, setItems] = useState<BoardProjection[]>([]);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<BoardProjection | "new">();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [workspace, setWorkspace] = useState("none");
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
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };
  const ticket = items.find(
    (item) => item.id === ticketId || `WRK-${item.fields.number}` === ticketId,
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
                  Updated by {ticket.lastActor.label}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="whitespace-pre-wrap break-words">
                  {String(ticket.fields.body ?? "")}
                </p>
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
        <div className="flex min-w-0 flex-col gap-4 overflow-x-auto md:flex-row">{Object.entries(statuses).filter(([status]) => items.some((item) => String(item.fields.status ?? "backlog") === status)).map(([status, label]) => <section key={status} className="flex min-w-64 flex-1 flex-col gap-3" aria-label={label}><h2 className="text-sm text-muted-foreground">{label}</h2>{items.filter((item) => String(item.fields.status ?? "backlog") === status).map(renderCard)}</section>)}</div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No tickets yet</EmptyTitle>
            <EmptyDescription>
              Create a ticket to share work with your organization.
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
        <DialogContent>
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
                      <SelectItem value="none">Organization</SelectItem>
                      {workspaces.value?.workspaces.map((w) => (
                        <SelectItem value={w.id} key={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
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
