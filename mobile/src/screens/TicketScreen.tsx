import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Link2, Link2Off, MessageSquare, Pencil, Trash2 } from "lucide-react-native";
import { color, radius, space, type } from "../theme";
import { apiError } from "../lib/api-error";
import { permissionOf } from "../lib/chat-options";
import { DERIVED_STATUSES, STATUS_LABEL, TICKET_STATUSES, byRank } from "../lib/tickets";
import { useStore } from "../state/store";
import { Button } from "../components/Button";
import { EmptyState } from "../components/Empty";
import { MenuItem, Popover } from "../components/ComposerMenu";
import type { Agent, Ticket, TicketActivity } from "../state/types";

const PRIORITIES = [0, 1, 2, 3, 4] as const;

export function TicketScreen({
  ticketKey,
  onOpenThread,
  onOpenTicket,
  onDeleted,
}: {
  ticketKey: string;
  onOpenThread: (id: string) => void;
  onOpenTicket: (key: string) => void;
  onDeleted: () => void;
}) {
  const ticket = useStore((s) => s.tickets.find((entry) => entry.key === ticketKey));
  const loadBoard = useStore((s) => s.loadBoard);
  const updateTicket = useStore((s) => s.updateTicket);
  const moveTicket = useStore((s) => s.moveTicket);
  const startTicket = useStore((s) => s.startTicket);
  const deleteTicket = useStore((s) => s.deleteTicket);
  const createTicket = useStore((s) => s.createTicket);
  const commentOnTicket = useStore((s) => s.commentOnTicket);
  const editTicketComment = useStore((s) => s.editTicketComment);
  const deleteTicketComment = useStore((s) => s.deleteTicketComment);
  const ticketActivity = useStore((s) => s.ticketActivity);
  const attachThread = useStore((s) => s.attachThread);
  const detachThread = useStore((s) => s.detachThread);
  const handoffTicket = useStore((s) => s.handoffTicket);
  const chats = useStore((s) => s.chats);
  const agents = useStore((s) => s.agents);
  const tickets = useStore((s) => s.tickets);
  const projects = useStore((s) => s.projects);
  const workspaces = useStore((s) => s.workspaces);
  const servers = useStore((s) => s.servers);
  const settings = useStore((s) => s.settings);
  const boardDevices = useStore((s) => s.boardDevices);
  const [activity, setActivity] = useState<TicketActivity[]>([]);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [branch, setBranch] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [subTitle, setSubTitle] = useState("");
  const [subScope, setSubScope] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!ticket) void loadBoard().catch(() => {});
  }, [ticket, loadBoard]);

  const refreshActivity = async (current: Ticket) => {
    try {
      setActivity(await ticketActivity(current.id));
    } catch {
      // The rest of the ticket remains useful while one activity read fails.
    }
  };

  useEffect(() => {
    if (!ticket) return;
    setTitle(ticket.title);
    setScope(ticket.body);
    setBranch(ticket.branch ?? "");
    void refreshActivity(ticket);
  }, [ticket?.id, ticket?.updatedAt]);

  if (!ticket) {
    return <View style={styles.wrap}><EmptyState title="No such ticket" detail={`${ticketKey} is not on this board.`} /></View>;
  }

  const project = projects.find((entry) => entry.id === ticket.projectId);
  const workspaceCopies = workspaces.filter((workspace) =>
    project?.workspaceIds.includes(workspace.id) || Boolean(project?.origin && workspace.origin === project.origin));
  const children = tickets.filter((entry) => entry.parentId === ticket.id).sort(byRank);
  const parent = ticket.parentId ? tickets.find((entry) => entry.id === ticket.parentId) : undefined;
  const parentChoices = tickets.filter((entry) =>
    entry.id !== ticket.id && entry.projectId === ticket.projectId && !entry.parentId);
  const linked = new Set(tickets.flatMap((entry) => entry.threads.map((thread) => thread.chatId)));
  const attachable = chats.filter((chat) => !chat.dm && !linked.has(chat.id));
  const people = agents.filter((agent) => !agent.builtIn);
  const deviceLink = ticket.deviceId
    ? boardDevices.find((entry) => entry.deviceId === ticket.deviceId)
    : boardDevices.find((entry) => entry.serverId === ticket.serverId);
  const device = servers.find((entry) => entry.id === deviceLink?.serverId);
  const workspace = workspaceCopies.find((entry) => entry.serverId === device?.id) ?? workspaceCopies[0];
  const defaults = device ? settings[device.id] : undefined;
  const provider = workspace?.provider ?? defaults?.defaultProvider ?? "claude";
  const model = workspace?.provider ? workspace.model : defaults?.defaultModel;
  const effort = workspace?.provider ? workspace.effort : defaults?.defaultEffort;
  const checkout = defaults?.defaultCheckout ?? "main";
  const permission = permissionOf(defaults?.defaultPermissionMode).label;
  const assignee = assigneeName(ticket, agents);
  const canStart = (ticket.status === "backlog" || ticket.status === "todo") && Boolean(device?.online && workspace);

  const saveFields = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await updateTicket(ticket.id, { title, body: scope, branch });
      setEditing(false);
    } catch (caught) {
      setError(apiError(caught));
    } finally {
      setBusy(false);
    }
  };

  const run = async (act: () => Promise<unknown>, message: string) => {
    setError(undefined);
    try {
      await act();
      await refreshActivity(ticket);
    } catch (caught) {
      setError(`${message}: ${apiError(caught)}`);
    }
  };

  const addComment = async () => {
    const body = commentBody.trim();
    if (!body) return;
    await run(async () => {
      await commentOnTicket(ticket.id, body);
      setCommentBody("");
    }, "Couldn't add that comment");
  };

  const createSubTicket = async () => {
    if (!subTitle.trim()) return;
    await run(async () => {
      const child = await createTicket({
        projectId: ticket.projectId,
        parentId: ticket.id,
        title: subTitle.trim(),
        ...(subScope.trim() ? { body: subScope.trim() } : {}),
      });
      setAddingSub(false);
      setSubTitle("");
      setSubScope("");
      onOpenTicket(child.key);
    }, "Couldn't create that sub-ticket");
  };

  const confirmDelete = () => {
    Alert.alert(`Delete ${ticket.key}?`, children.length > 0
      ? `Its ${children.length} sub-ticket${children.length === 1 ? " stays" : "s stay"}, without a parent.`
      : "Threads that worked on it keep running.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void deleteTicket(ticket.id)
          .then(onDeleted)
          .catch((caught) => setError(`Couldn't delete that ticket: ${apiError(caught)}`)),
      },
    ]);
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {parent ? (
        <Pressable onPress={() => onOpenTicket(parent.key)} accessibilityLabel={`Open ${parent.key}`}>
          <Text style={type.caption}>{`Parent · ${parent.key}`}</Text>
        </Pressable>
      ) : null}
      <View style={styles.titleRow}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={type.caption}>{ticket.key}</Text>
          <Text style={type.title}>{ticket.title}</Text>
        </View>
        <Pressable onPress={() => setEditing(true)} accessibilityLabel="Edit ticket" style={styles.iconButton}>
          <Pencil size={17} color={color.foreground} />
        </Pressable>
        <Pressable onPress={confirmDelete} accessibilityLabel={`Delete ${ticket.key}`} style={styles.iconButton}>
          <Trash2 size={17} color={color.destructive} />
        </Pressable>
      </View>
      {ticket.body ? <Text style={type.body}>{ticket.body}</Text> : <Text style={type.caption}>Add a scope for this work.</Text>}

      {!workspace ? (
        <Notice title="This workspace is unavailable." detail="Add it on a connected computer before starting work." />
      ) : !device?.online ? (
        <Notice title="This computer is unavailable." detail="Choose another computer below, or try again when it reconnects." />
      ) : null}

      <Section title="Status">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {TICKET_STATUSES.map((status) => (
            <Chip
              key={status}
              label={STATUS_LABEL[status]}
              selected={ticket.status === status}
              onPress={() => void run(() => moveTicket(ticket.id, status), "Couldn't move that ticket")}
            />
          ))}
        </ScrollView>
        {DERIVED_STATUSES.includes(ticket.status) && ticket.threads.length > 0 ? (
          <Text style={type.caption}>Remy moves this while a thread works on it.</Text>
        ) : null}
      </Section>

      <Section title="Priority">
        <View style={styles.chips}>
          {PRIORITIES.map((priority) => (
            <Chip
              key={priority}
              label={priority === 0 ? "None" : `P${priority}`}
              selected={ticket.priority === priority}
              onPress={() => void run(() => updateTicket(ticket.id, { priority }), "Couldn't save that priority")}
            />
          ))}
        </View>
      </Section>

      <Section title="Assignee">
        <Text style={type.callout}>{assignee}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Nobody" selected={!ticket.assigneeAgentId} onPress={() => void run(() => updateTicket(ticket.id, { assigneeAgentId: "" }), "Couldn't save that assignee")} />
          <Chip label="You" selected={ticket.assigneeAgentId === "you"} onPress={() => void run(() => updateTicket(ticket.id, { assigneeAgentId: "you" }), "Couldn't save that assignee")} />
          <Chip label="Workspace agent" selected={ticket.assigneeAgentId === "workspace"} onPress={() => void run(() => updateTicket(ticket.id, { assigneeAgentId: "workspace" }), "Couldn't save that assignee")} />
          {people.map((agent) => (
            <Chip key={agent.id} label={agent.name} selected={ticket.assigneeAgentId === agent.id} onPress={() => void run(() => updateTicket(ticket.id, { assigneeAgentId: agent.id }), "Couldn't save that assignee")} />
          ))}
        </ScrollView>
        {people.length > 0 ? <Button label="Hand off…" variant="outline" onPress={() => setHandoff(true)} /> : null}
      </Section>

      <Section title="Computer">
        <Text style={type.callout}>{device?.name ?? "Unavailable computer"}</Text>
        {workspaceCopies.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {workspaceCopies.map((copy) => {
              const server = servers.find((entry) => entry.id === copy.serverId);
              const record = boardDevices.find((entry) => entry.serverId === copy.serverId);
              return (
                <Chip
                  key={`${copy.serverId}:${copy.id}`}
                  label={server?.name ?? "Unavailable computer"}
                  selected={device?.id === copy.serverId}
                  disabled={!record || !server?.online}
                  onPress={() => record && void run(() => updateTicket(ticket.id, { deviceId: record.deviceId }), "Couldn't save that computer")}
                />
              );
            })}
          </ScrollView>
        ) : null}
      </Section>

      <Section title="Parent">
        <Text style={type.callout}>{parent ? `${parent.key} · ${parent.title}` : "No parent"}</Text>
        {children.length === 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="No parent" selected={!parent} onPress={() => void run(() => updateTicket(ticket.id, { parentId: "" }), "Couldn't save that parent")} />
            {parentChoices.map((candidate) => (
              <Chip key={candidate.id} label={candidate.key} selected={candidate.id === ticket.parentId} onPress={() => void run(() => updateTicket(ticket.id, { parentId: candidate.id }), "Couldn't save that parent")} />
            ))}
          </ScrollView>
        ) : <Text style={type.caption}>A ticket with sub-tickets cannot become a sub-ticket.</Text>}
      </Section>

      {(ticket.status === "backlog" || ticket.status === "todo") ? (
        <Section title="Start work">
          <Text style={type.caption}>{`${provider}${model ? ` · ${model}` : " · default model"}${effort ? ` · ${effort}` : ""} · ${permission} · ${checkout === "worktree" ? "new worktree" : "main checkout"}`}</Text>
          <Button
            label="Start thread"
            disabled={!canStart || busy}
            onPress={() => {
              setBusy(true);
              void startTicket(ticket.id)
                .then((thread) => onOpenThread(thread.id))
                .catch((caught) => setError(`Couldn't start that thread: ${apiError(caught)}`))
                .finally(() => setBusy(false));
            }}
          />
        </Section>
      ) : null}

      <Section title="Sub-tickets" action={!parent ? { label: "Add", onPress: () => setAddingSub(true) } : undefined}>
        {children.length === 0 ? <Text style={type.caption}>{parent ? "A sub-ticket cannot have its own." : "Break this into pieces if it is too big."}</Text> : children.map((child) => (
          <Pressable key={child.id} onPress={() => onOpenTicket(child.key)} style={styles.link}>
            <Text style={type.caption}>{`${child.key} · ${STATUS_LABEL[child.status]}`}</Text>
            <Text style={type.callout}>{child.title}</Text>
          </Pressable>
        ))}
      </Section>

      <Section title="Threads" action={{ label: "Attach", onPress: () => setAttaching(true) }}>
        {ticket.threads.length === 0 ? <Text style={type.caption}>No thread has worked on this yet.</Text> : ticket.threads.map((link) => {
          const thread = chats.find((entry) => entry.id === link.chatId);
          const runner = link.agentId ? agents.find((entry) => entry.id === link.agentId)?.name : undefined;
          return (
            <View key={`${link.deviceId}:${link.chatId}`} style={styles.threadRow}>
              <Pressable disabled={!thread} onPress={() => thread && onOpenThread(link.chatId)} style={{ flex: 1, gap: 3 }}>
                <Text style={type.callout}>{thread?.title ?? "A thread on an unavailable computer"}</Text>
                <Text style={type.caption}>{runner ? `${runner} · ${link.stage ?? "attached"}` : link.stage ?? "Attached by you"}</Text>
              </Pressable>
              <Pressable
                onPress={() => void run(() => detachThread(ticket.id, link.chatId, link.deviceId), "Couldn't detach that thread")}
                accessibilityLabel="Detach thread"
                style={styles.iconButton}
              >
                <Link2Off size={16} color={color.mutedForeground} />
              </Pressable>
            </View>
          );
        })}
      </Section>

      <Section title="Activity">
        {activity.length === 0 ? <Text style={type.caption}>Nothing has happened yet.</Text> : activity.map((item) => (
          <ActivityRow
            key={item.id}
            item={item}
            agents={agents}
            onEdit={(body) => run(() => editTicketComment(ticket.id, item.id, body), "Couldn't edit that comment")}
            onDelete={() => run(() => deleteTicketComment(ticket.id, item.id), "Couldn't delete that comment")}
          />
        ))}
        <View style={styles.mentions}>
          {people.map((agent) => (
            <Pressable key={agent.id} onPress={() => setCommentBody((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${agent.handle} `)}>
              <Text style={styles.mention}>{`@${agent.handle}`}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={commentBody}
          onChangeText={setCommentBody}
          placeholder="Write a comment. @ names an agent."
          placeholderTextColor={color.mutedForeground}
          style={[styles.input, styles.comment]}
          multiline
        />
        <Button label="Add comment" disabled={!commentBody.trim()} onPress={() => void addComment()} />
      </Section>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Popover open={editing} onClose={() => setEditing(false)}>
        <View style={styles.form}>
          <Text style={type.heading}>Edit ticket</Text>
          <Text style={type.caption}>Title</Text>
          <TextInput value={title} onChangeText={setTitle} accessibilityLabel="Ticket title" style={styles.input} />
          <Text style={type.caption}>Scope</Text>
          <TextInput value={scope} onChangeText={setScope} accessibilityLabel="Ticket scope" multiline style={[styles.input, styles.area]} />
          <Text style={type.caption}>Branch</Text>
          <TextInput value={branch} onChangeText={setBranch} accessibilityLabel="Ticket branch" autoCapitalize="none" autoCorrect={false} style={styles.input} />
          <Button label="Save changes" busy={busy} disabled={!title.trim()} onPress={() => void saveFields()} />
        </View>
      </Popover>

      <Popover open={addingSub} onClose={() => setAddingSub(false)}>
        <View style={styles.form}>
          <Text style={type.heading}>New sub-ticket</Text>
          <TextInput value={subTitle} onChangeText={setSubTitle} autoFocus placeholder="What needs doing?" placeholderTextColor={color.mutedForeground} style={styles.input} />
          <TextInput value={subScope} onChangeText={setSubScope} placeholder="What does done look like?" placeholderTextColor={color.mutedForeground} multiline style={[styles.input, styles.area]} />
          <Button label="Create sub-ticket" disabled={!subTitle.trim()} onPress={() => void createSubTicket()} />
        </View>
      </Popover>

      <Popover open={attaching} onClose={() => setAttaching(false)}>
        {attachable.length === 0 ? <Text style={styles.empty}>No unattached threads are available.</Text> : attachable.map((thread) => (
          <MenuItem
            key={`${thread.serverId}:${thread.id}`}
            icon={Link2}
            label={thread.title}
            detail={servers.find((server) => server.id === thread.serverId)?.name}
            onPress={() => {
              setAttaching(false);
              void run(() => attachThread(ticket.id, thread.id), "Couldn't attach that thread");
            }}
          />
        ))}
      </Popover>

      <Popover open={handoff} onClose={() => setHandoff(false)}>
        {people.map((agent) => (
          <MenuItem
            key={agent.id}
            label={agent.name}
            detail={`@${agent.handle}`}
            onPress={() => {
              setHandoff(false);
              void run(() => handoffTicket(ticket.id, agent.id), "Couldn't hand off that ticket");
            }}
          />
        ))}
      </Popover>
    </ScrollView>
  );
}

function assigneeName(ticket: Ticket, agents: Agent[]): string {
  if (!ticket.assigneeAgentId) return "Nobody";
  if (ticket.assigneeAgentId === "you") return "You";
  if (ticket.assigneeAgentId === "workspace") return "Workspace agent";
  return agents.find((agent) => agent.id === ticket.assigneeAgentId)?.name ?? "Unavailable agent";
}

function describe(item: TicketActivity): string {
  const status = typeof item.detail?.status === "string" ? item.detail.status : undefined;
  if (item.kind === "create") return "created this ticket";
  if (item.kind === "comment") return "commented";
  if (item.kind === "link") return "attached a thread";
  if (item.kind === "unlink") return "detached a thread";
  if (item.kind === "handoff") return "handed this on";
  if (item.kind === "status" && status) return `moved this to ${STATUS_LABEL[status as keyof typeof STATUS_LABEL] ?? status}`;
  return "changed this ticket";
}

function ActivityRow({
  item,
  agents,
  onEdit,
  onDelete,
}: {
  item: TicketActivity;
  agents: Agent[];
  onEdit: (body: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.body ?? "");
  const mine = item.kind === "comment" && item.actor === "you";
  const actor = item.actor === "you" ? "You"
    : item.actor === "remy" ? "Remy"
      : agents.find((agent) => agent.id === item.actor || agent.handle === item.actor)?.name ?? item.actor;
  return (
    <View style={styles.event}>
      <View style={styles.eventHead}>
        <MessageSquare size={13} color={color.mutedForeground} />
        <Text style={type.caption}>{`${actor} ${describe(item)}${item.editedAt ? " · edited" : ""}`}</Text>
      </View>
      {editing ? (
        <>
          <TextInput value={draft} onChangeText={setDraft} autoFocus multiline style={[styles.input, styles.comment]} />
          <View style={styles.chips}>
            <Button label="Save" onPress={() => void onEdit(draft).then(() => setEditing(false))} />
            <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
          </View>
        </>
      ) : item.body ? <Text style={type.callout}>{item.body}</Text> : null}
      {mine && !editing ? (
        <View style={styles.eventActions}>
          <Pressable onPress={() => setEditing(true)}><Text style={styles.eventAction}>Edit</Text></Pressable>
          <Pressable onPress={() => Alert.alert("Delete this comment?", "It disappears from the ticket's activity.", [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: () => void onDelete() },
          ])}><Text style={[styles.eventAction, { color: color.destructive }]}>Delete</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Section({ children, title, action }: { children: React.ReactNode; title: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={type.caption}>{title}</Text>
        {action ? <Pressable onPress={action.onPress}><Text style={styles.sectionAction}>{action.label}</Text></Pressable> : null}
      </View>
      {children}
    </View>
  );
}

function Chip({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.chip, selected && styles.chipOn, disabled && { opacity: 0.35 }]}>
      <Text style={[styles.chipLabel, selected && { color: color.primaryForeground }]}>{label}</Text>
    </Pressable>
  );
}

function Notice({ title, detail }: { title: string; detail: string }) {
  return <View style={styles.notice}><Text style={type.callout}>{title}</Text><Text style={type.caption}>{detail}</Text></View>;
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: color.background },
  content: { padding: space.lg, gap: space.lg, paddingBottom: 48 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.md },
  notice: { borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 12, gap: 3 },
  section: { gap: space.sm },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionAction: { color: color.primary, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: color.border, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: color.card },
  chipOn: { backgroundColor: color.primary, borderColor: color.primary },
  chipLabel: { fontSize: 13, color: color.foreground },
  link: { borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 12, gap: 4, backgroundColor: color.card },
  threadRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: 10, gap: 8, backgroundColor: color.card },
  event: { borderLeftWidth: 2, borderLeftColor: color.border, paddingLeft: 10, gap: 6 },
  eventHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  eventActions: { flexDirection: "row", gap: space.md },
  eventAction: { color: color.primary, fontSize: 12 },
  mentions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mention: { color: color.primary, fontSize: 12 },
  input: { borderWidth: 1, borderColor: color.border, backgroundColor: color.card, borderRadius: radius.lg, padding: 12, color: color.foreground },
  comment: { minHeight: 72, textAlignVertical: "top" },
  area: { minHeight: 100, textAlignVertical: "top" },
  form: { padding: space.md, gap: space.sm },
  empty: { ...type.caption, textAlign: "center", padding: space.xl },
  error: { color: color.destructive, fontSize: 13 },
});
