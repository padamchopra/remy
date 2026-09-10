import { usePersonalHub } from "@/lib/hub-scope";
import { HubAgentRoutines } from "./HubAgentRoutines";
import { useEffect, useState } from "react";
import type { BoardProjection } from "@remy/contract";
import { hubRequest, hubThreadBase } from "@/lib/hub-threads";
import { watchHubResource } from "@/lib/hub-computers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
type AgentRun = {
  threadId: string;
  computerId: string;
  computerName: string;
  state: string;
  available: boolean;
};
type Message = { id: string; role: string; text: string; at: number };
export function HubInbox({
  organizationId,
  userId,
  agentId,
  choose,
}: {
  organizationId: string;
  userId: string;
  agentId?: string;
  choose: (id: string) => void;
}) {
  const isPersonal = usePersonalHub();
  const base = hubThreadBase(organizationId),
    [agents, setAgents] = useState<BoardProjection[]>([]),
    [messages, setMessages] = useState<Message[]>([]),
    [memories, setMemories] = useState<BoardProjection[]>([]),
    [teams, setTeams] = useState<{ id: string; name: string }[]>([]),
    [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]),
    [name, setName] = useState(""),
    [scope, setScope] = useState("personal"),
    [owner, setOwner] = useState(""),
    [text, setText] = useState(""),
    [memory, setMemory] = useState(""),
    [promotion, setPromotion] = useState(""),
    [error, setError] = useState("");
  const [runs, setRuns] = useState<AgentRun[]>([]);
  useEffect(() => {
    setRuns([]);
    if (!agentId) return;
    return watchHubResource<{ runs: AgentRun[] }>(
      `${base}/agents/${agentId}/runs`,
      (v) => setRuns(v?.runs ?? []),
      setError,
      `${base}/board/live`,
    );
  }, [base, agentId]);
  const agent = agents.find((a) => a.id === agentId);
  useEffect(
    () =>
      watchHubResource<{ agents: BoardProjection[] }>(
        `${base}/agents`,
        (v) => setAgents(v?.agents ?? []),
        setError,
        `${base}/board/live`,
      ),
    [base],
  );
  useEffect(() => {
    void Promise.all([
      hubRequest<{ teams: typeof teams }>(`${base}/teams`),
      hubRequest<{ workspaces: typeof workspaces }>(`${base}/workspaces`),
    ])
      .then(([t, w]) => {
        setTeams(t.teams);
        setWorkspaces(w.workspaces);
      })
      .catch((e) => setError(e.message));
  }, [base]);
  useEffect(() => {
    setMessages([]);
    setMemories([]);
    if (!agentId) return;
    const off = watchHubResource<{ messages: Message[] }>(
      `${base}/agents/${agentId}/conversation`,
      (v) => setMessages(v?.messages ?? []),
      setError,
      `${base}/board/live`,
    );
    const offMemory = watchHubResource<{ items: BoardProjection[] }>(
      `${base}/board/memories`,
      (v) =>
        setMemories(
          (v?.items ?? []).filter((m) => m.fields.agentId === agentId),
        ),
      setError,
      `${base}/board/live`,
    );
    return () => {
      off();
      offMemory();
    };
  }, [base, agentId]);
  const append = async (
    entity: string,
    entityId: string,
    kind: string,
    payload: Record<string, unknown>,
  ) =>
    hubRequest(`${base}/board/events`, "POST", {
      entity,
      entityId,
      kind,
      payload,
    });
  const attempt = (action: () => Promise<unknown>) => {
    setError("");
    void action().catch((e) => setError(e.message));
  };
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6"
      aria-label="Inbox"
    >
      <h1>Inbox</h1>
      <div className="flex flex-wrap gap-6">
        <div className="flex w-56 shrink-0 flex-col gap-4">
          {[
            ["org", isPersonal ? "Your agents" : "Organization"],
            ...(!isPersonal ? [["team", "Teams"]] : []),
            ["workspace", "Workspaces"],
            ["personal", "Only you"],
          ].filter(([key]) => agents.some(a => (a.fields.scope ?? "org") === key)).map(([key, label]) => (
            <div key={key}>
              <h2 className="mb-2 text-sm text-muted-foreground">{label}</h2>
              {agents
                .filter((a) => (a.fields.scope ?? "org") === key)
                .map((a) => (
                  <Button
                    key={a.id}
                    variant={a.id === agentId ? "secondary" : "ghost"}
                    className="w-full justify-start"
                    data-link
                    onClick={() => choose(a.id)}
                  >
                    {String(a.fields.name)}
                  </Button>
                ))}
            </div>
          ))}
          <form
            className="flex flex-col gap-3 rounded-lg border p-3"
            aria-label="Create agent"
            onSubmit={(e) => {
              e.preventDefault();
              attempt(async () => {
                const id = crypto.randomUUID();
                await append("agent", id, "create", {
                  name,
                  handle: id,
                  scope,
                  ownerId:
                    scope === "personal"
                      ? userId
                      : scope === "org"
                        ? organizationId
                        : owner,
                });
                setName("");
                choose(id);
              });
            }}
          >
            <Field>
              <FieldLabel htmlFor="agent-name">Agent name</FieldLabel>
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
              />
            </Field>
            <Field>
              <FieldLabel>Visible to</FieldLabel>
              <Select
                value={scope}
                onValueChange={(v) => {
                  setScope(v);
                  setOwner("");
                }}
              >
                <SelectTrigger aria-label="Agent visibility">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Only you</SelectItem>
                  {!isPersonal && <SelectItem value="team">A team</SelectItem>}
                  <SelectItem value="workspace">A workspace</SelectItem>
                  <SelectItem value="org">
                    {isPersonal ? "Your account" : "Your organization"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {["team", "workspace"].includes(scope) && (
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger aria-label="Agent owner">
                  <SelectValue
                    placeholder={
                      scope === "team" ? "Choose a team" : "Choose a workspace"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {(scope === "team" ? teams : workspaces).map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="submit"
              disabled={
                !name.trim() ||
                (["team", "workspace"].includes(scope) && !owner)
              }
            >
              Create agent
            </Button>
          </form>
        </div>
        {agent && (
          <div className="flex min-w-0 flex-1 basis-80 flex-col gap-4">
            <h2>{String(agent.fields.name)}</h2>
            {agent.fields.builtIn === "orchestrator" && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = new FormData(e.currentTarget).get("name");
                  attempt(() =>
                    append("agent", agent.id, "field", { name: String(value) }),
                  );
                }}
              >
                <Input
                  aria-label="Agent name"
                  name="name"
                  defaultValue={String(agent.fields.name)}
                  maxLength={120}
                />
                <Button type="submit" variant="outline">
                  Rename agent
                </Button>
              </form>
            )}
            <div
              className="flex flex-col gap-3 rounded-lg border p-4"
              aria-label="Agent conversation"
            >
              {messages.length ? (
                messages.map((m) => (
                  <p key={m.id} className="whitespace-pre-wrap break-words">
                    <span className="text-muted-foreground">
                      {m.role === "user" ? "You" : String(agent.fields.name)}
                      :{" "}
                    </span>
                    {m.text}
                  </p>
                ))
              ) : (
                <p>Start a conversation with {String(agent.fields.name)}.</p>
              )}
            </div>
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                attempt(async () => {
                  const result = await hubRequest<{ messages: Message[] }>(
                    `${base}/agents/${agent.id}/message`,
                    "POST",
                    { text, messageId: crypto.randomUUID() },
                  );
                  setMessages(result.messages);
                  setText("");
                });
              }}
            >
              <Field>
                <FieldLabel htmlFor="agent-message">Message</FieldLabel>
                <Textarea
                  id="agent-message"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={32000}
                />
              </Field>
              <Button type="submit" disabled={!text.trim()}>
                Send message
              </Button>
            </form>
            <h3>Threads</h3>
            {runs.map((run) => (
              <Button
                key={run.threadId}
                variant="outline"
                asChild
                disabled={!run.available}
              >
                <a
                  aria-disabled={!run.available}
                  href={
                    run.available
                      ? `#/threads/${run.threadId}?organization=${encodeURIComponent(organizationId)}&computer=${encodeURIComponent(run.computerId)}`
                      : undefined
                  }
                >
                  {run.computerName} · {run.state}
                </a>
              </Button>
            ))}
            <HubAgentRoutines
              organizationId={organizationId}
              agentId={agent.id}
            />
            <h3>Memories</h3>
            <p className="text-sm text-muted-foreground">
              Everyone who can see this agent can read its memories.
            </p>
            {memories.map((m) => (
              <div key={m.id} className="flex items-start gap-2">
                <p className="flex-1 break-words">{String(m.fields.content)}</p>
                <Button
                  variant="ghost"
                  onClick={() =>
                    attempt(() => append("memory", m.id, "tombstone", {}))
                  }
                >
                  Remove memory
                </Button>
              </div>
            ))}
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                attempt(async () => {
                  await append("memory", crypto.randomUUID(), "create", {
                    agentId: agent.id,
                    content: memory,
                    scope: "global",
                  });
                  setMemory("");
                });
              }}
            >
              <Input
                aria-label="New memory"
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
              />
              <Button type="submit" disabled={!memory.trim()}>
                Save memory
              </Button>
            </form>
            {!agent.fields.builtIn && (
              <>
                {!isPersonal && (
                  <>
                    <h3>Share this agent</h3>
                    <p className="text-sm text-muted-foreground">
                      Sharing includes this conversation and its memories.
                    </p>
                    {agent.fields.scope === "personal" && (
                      <Select value={promotion} onValueChange={setPromotion}>
                        <SelectTrigger aria-label="Share with team">
                          <SelectValue placeholder="Choose a team" />
                        </SelectTrigger>
                        <SelectContent>
                          {teams.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {["personal", "team"].includes(
                      String(agent.fields.scope),
                    ) && (
                      <Button
                        variant="outline"
                        disabled={
                          agent.fields.scope === "personal" && !promotion
                        }
                        onClick={() =>
                          attempt(() =>
                            append(
                              "agent",
                              agent.id,
                              "field",
                              agent.fields.scope === "personal"
                                ? { scope: "team", ownerId: promotion }
                                : { scope: "org", ownerId: organizationId },
                            ),
                          )
                        }
                      >
                        {agent.fields.scope === "personal"
                          ? "Share with team"
                          : "Share with organization"}
                      </Button>
                    )}
                  </>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline">Delete agent</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this agent?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This removes its conversation and memories for everyone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() =>
                          attempt(() =>
                            append("agent", agent.id, "tombstone", {}),
                          )
                        }
                      >
                        Delete agent
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
