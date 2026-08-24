import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { basename } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { REMY_TOOL_INSTRUCTIONS } from "./ticket-tool-contract.js";
import { artifactMarker, type ConvArtifact } from "./remy-artifacts.js";

interface ApiTicket {
  id: string;
  key: string;
  projectId: string;
  title: string;
  body: string;
  status: string;
  priority: number;
  assigneeAgentId?: string;
  branch?: string;
  parentId?: string;
  threads: { chatId: string; deviceId: string }[];
}

interface ApiAgent {
  id: string;
  handle: string;
  name: string;
  role?: string;
  handoffTo: string[];
}

interface ApiWorkspace {
  id: string;
  name: string;
  path: string;
  origin?: string | null;
}

interface ApiThread {
  id: string;
  title: string;
  cwd: string;
  state: string;
  provider: string;
  model?: string;
  agentId?: string;
  preview?: string;
  entries?: {
    kind: string;
    text?: string;
    verb?: string;
    arg?: string;
    status?: string;
  }[];
}

interface Board {
  tickets?: ApiTicket[];
  agents?: ApiAgent[];
  projects?: { id: string; name: string; workspaceIds?: string[] }[];
}

const apiUrl = process.env.REMY_API_URL ?? "http://127.0.0.1:8420";
const token = process.env.REMY_API_TOKEN
  ?? (process.env.REMY_MCP_PROVIDER
    ? (await import("./external-mcp-auth.js")).externalMcpToken(process.env.REMY_MCP_PROVIDER)
    : undefined)
  ?? "";
const chatId = process.env.REMY_CHAT_ID ?? "";
const threadDeviceId = process.env.REMY_DEVICE_ID ?? "";
const agentId = process.env.REMY_AGENT_ID ?? "";

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? `${response.status} ${response.statusText}`));
  return body as T;
}

async function board(): Promise<Board> {
  return request<Board>("/board");
}

async function ticketFor(key?: string): Promise<{ ticket: ApiTicket; board: Board }> {
  const snapshot = await board();
  const tickets = snapshot.tickets ?? [];
  const ticket = key
    ? tickets.find((entry) => entry.key === key.trim().toUpperCase())
    : tickets.find((entry) => entry.threads.some((thread) =>
      thread.chatId === chatId && (!threadDeviceId || thread.deviceId === threadDeviceId)));
  if (!ticket) throw new Error(key ? `No ticket called ${key}.` : "This thread is not linked to a ticket.");
  return { ticket, board: snapshot };
}

async function describe(key?: string): Promise<string> {
  const { ticket, board: snapshot } = await ticketFor(key);
  const project = snapshot.projects?.find((entry) => entry.id === ticket.projectId);
  const agent = snapshot.agents?.find((entry) => entry.id === ticket.assigneeAgentId);
  const children = snapshot.tickets?.filter((entry) => entry.parentId === ticket.id) ?? [];
  const activity = await request<{ activity?: { actor: string; kind: string; body?: string }[] }>(
    `/tickets/${encodeURIComponent(ticket.id)}/activity`,
  );
  return [
    `${ticket.key}: ${ticket.title}`,
    `Workspace: ${project?.name ?? "Unknown"}`,
    `Status: ${ticket.status}`,
    `Priority: ${ticket.priority}`,
    `Assignee: ${agent?.name ?? ticket.assigneeAgentId ?? "Nobody"}`,
    ticket.branch ? `Branch: ${ticket.branch}` : "",
    ticket.body ? `\nDescription:\n${ticket.body}` : "\nNo description.",
    children.length
      ? `\nSub-tickets:\n${children.map((child) => `- ${child.key} [${child.status}] ${child.title}`).join("\n")}`
      : "",
    activity.activity?.length
      ? `\nRecent activity:\n${activity.activity.slice(-20).map((entry) => `- ${entry.actor} ${entry.kind}${entry.body ? `: ${entry.body}` : ""}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");
}

/// A tool's answer, and the card the feed draws under it. Same marker the
/// in-process server uses, so a card looks the same on every provider.
function ok(text: string, artifact?: ConvArtifact) {
  return { content: [{ type: "text" as const, text: artifact ? text + artifactMarker(artifact) : text }] };
}

function ticketCard(ticket: ApiTicket): ConvArtifact {
  return { kind: "ticket", key: ticket.key, title: ticket.title, detail: ticket.status };
}

function workspaceName(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  return basename(trimmed === "~" ? homedir() : trimmed) || "Workspace";
}

async function workspaces(): Promise<ApiWorkspace[]> {
  return (await request<{ workspaces?: ApiWorkspace[] }>("/workspaces")).workspaces ?? [];
}

/// The workspace a reference names, or the one this thread is already in.
async function workspaceFor(reference?: string): Promise<ApiWorkspace | undefined> {
  const listed = await workspaces();
  if (!reference?.trim()) {
    const current = await request<ApiThread>(`/chats/${encodeURIComponent(chatId)}`);
    return listed.find((workspace) => workspace.path === current.cwd);
  }
  const asked = reference.trim();
  const matches = listed.filter((workspace) =>
    workspace.id === asked
    || workspace.path === asked
    || workspace.origin === asked
    || workspace.name.toLowerCase() === asked.toLowerCase());
  if (matches.length === 0) throw new Error(`No workspace called ${asked}. Register it first if this is a new folder.`);
  if (matches.length > 1) throw new Error(`More than one workspace is called ${asked}. Use its id or path.`);
  return matches[0];
}

async function workspacePath(reference?: string): Promise<string> {
  if (!reference?.trim()) {
    const current = await request<ApiThread>(`/chats/${encodeURIComponent(chatId)}`);
    return current.cwd;
  }
  const asked = reference.trim();
  const matches = (await workspaces()).filter((workspace) =>
    workspace.id === asked
    || workspace.path === asked
    || workspace.origin === asked
    || workspace.name.toLowerCase() === asked.toLowerCase());
  if (matches.length === 0) throw new Error(`No workspace called ${asked}. Register it first if this is a new folder.`);
  if (matches.length > 1) throw new Error(`More than one workspace is called ${asked}. Use its id or path.`);
  return matches[0].path;
}

function describeThread(thread: ApiThread, agents: ApiAgent[]): string {
  const agent = agents.find((entry) => entry.id === thread.agentId);
  const recent = (thread.entries ?? []).slice(-20).map((entry) => entry.text
    ? `- ${entry.kind}: ${entry.text}`
    : `- ${entry.kind}: ${[entry.verb, entry.arg, entry.status].filter(Boolean).join(" ")}`);
  return [
    `${thread.title} (${thread.id})`,
    `State: ${thread.state}`,
    `Workspace folder: ${thread.cwd}`,
    `Provider: ${thread.provider}${thread.model ? ` / ${thread.model}` : ""}`,
    agent ? `Agent: @${agent.handle}` : "Agent: Workspace agent",
    thread.preview ? `Latest: ${thread.preview}` : "",
    recent.length ? `\nRecent thread activity:\n${recent.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

const key = z.string().optional().describe("Ticket key. Omit it for this thread's linked ticket.");
const server = new McpServer(
  { name: "remy", version: "1" },
  { instructions: REMY_TOOL_INSTRUCTIONS },
);

server.registerTool("list_workspaces", {
  description: "List the workspace folders registered on this machine.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async () => {
  const listed = await workspaces();
  return ok(listed.length
    ? listed.map((workspace) => `${workspace.name} (${workspace.id})\n${workspace.path}${workspace.origin ? `\n${workspace.origin}` : ""}`).join("\n\n")
    : "No workspaces are registered on this machine.");
});

server.registerTool("register_workspace", {
  description: "Register an existing Git repository folder as a Remy workspace.",
  inputSchema: {
    path: z.string().describe("Absolute or home-relative path to the repository folder"),
    name: z.string().max(80).optional().describe("Workspace name. Defaults to the folder name."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ path, name }) => {
  const result = await request<{ workspace: ApiWorkspace }>("/workspaces", {
    method: "POST",
    body: { path, name: name?.trim() || workspaceName(path) },
  });
  return ok(`Registered ${result.workspace.name} at ${result.workspace.path}.`, {
    kind: "workspace",
    id: result.workspace.id,
    title: result.workspace.name,
    detail: result.workspace.path,
  });
});

server.registerTool("run_with_environment", {
  description: "Run a program in this thread's workspace with its active environment. Values stay in Remy and exact matches are removed from output.",
  inputSchema: {
    program: z.string().min(1).max(500).describe("Executable name or absolute path"),
    args: z.array(z.string().max(20000)).max(200).optional().describe("Arguments passed directly to the executable"),
    timeout_seconds: z.number().int().min(1).max(300).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
}, async ({ program, args, timeout_seconds }) => {
  const result = await request<{ command: string; output: string; exitCode: number; environment: string }>(
    "/runtime/environment-command",
    { method: "POST", body: { program, args, timeoutSeconds: timeout_seconds } },
  );
  return ok([
    `${result.command} (${result.environment}) exited ${result.exitCode}.`,
    result.output || "The command produced no output.",
  ].join("\n\n"));
});

const browserPath = `/chats/${encodeURIComponent(chatId)}/browser`;
const browserTarget = {
  role: z.string().max(80).optional().describe("Accessible role, such as button, link, or textbox"),
  name: z.string().max(500).optional().describe("Accessible name or field label"),
  text: z.string().max(500).optional().describe("Visible text when a role is not known"),
  selector: z.string().max(1000).optional().describe("CSS selector as a fallback"),
  x: z.number().min(0).max(2000).optional(),
  y: z.number().min(0).max(2000).optional(),
};

server.registerTool("browser_open", {
  description: "Open a page in this thread's shared browser so the person can watch and take control.",
  inputSchema: { url: z.string().min(1).max(4000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ url }) => {
  await request(`${browserPath}/open`, { method: "POST", body: { url } });
  return ok(`Opened ${url} in the shared browser.`);
});

server.registerTool("browser_viewport", {
  description: "Switch the shared browser between desktop and mobile responsive layouts.",
  inputSchema: { viewport: z.enum(["desktop", "mobile"]) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ viewport }) => {
  const view = await request<{ width: number; height: number }>(`${browserPath}/viewport`, {
    method: "POST",
    body: { viewport },
  });
  return ok(`Switched the shared browser to ${viewport} (${view.width} × ${view.height}).`);
});

server.registerTool("browser_snapshot", {
  description: "Read the shared browser's current URL, visible text, interactive elements, console, and failed requests.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
}, async () => {
  const snapshot = await request<{ text: string }>(`${browserPath}/snapshot`, { method: "POST" });
  return ok(snapshot.text);
});

server.registerTool("browser_click", {
  description: "Click an element or coordinate in the shared browser. Prefer an accessible role and name.",
  inputSchema: browserTarget,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async (target) => {
  await request(`${browserPath}/click`, { method: "POST", body: target });
  return ok("Clicked in the shared browser.");
});

server.registerTool("browser_type", {
  description: "Replace the text in a field in the shared browser. Prefer its accessible role and name.",
  inputSchema: { ...browserTarget, value: z.string().max(20000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ value, ...target }) => {
  await request(`${browserPath}/type`, { method: "POST", body: { ...target, value } });
  return ok("Entered text in the shared browser.");
});

server.registerTool("browser_press", {
  description: "Press a key or shortcut in the shared browser, such as Enter, Escape, or Meta+R.",
  inputSchema: { key: z.string().min(1).max(100) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ key }) => {
  await request(`${browserPath}/press`, { method: "POST", body: { key } });
  return ok(`Pressed ${key} in the shared browser.`);
});

server.registerTool("browser_scroll", {
  description: "Scroll the shared browser by pixels.",
  inputSchema: {
    delta_x: z.number().min(-10000).max(10000).optional(),
    delta_y: z.number().min(-10000).max(10000),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ delta_x, delta_y }) => {
  await request(`${browserPath}/scroll`, { method: "POST", body: { deltaX: delta_x ?? 0, deltaY: delta_y } });
  return ok("Scrolled the shared browser.");
});

server.registerTool("browser_wait", {
  description: "Wait briefly for the shared page to update before reading it again.",
  inputSchema: { milliseconds: z.number().int().min(0).max(10000).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
}, async ({ milliseconds }) => {
  await request(`${browserPath}/wait`, { method: "POST", body: { milliseconds: milliseconds ?? 500 } });
  return ok("The shared browser finished waiting.");
});

server.registerTool("list_agents", {
  description: "List the agents available when starting a thread.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async () => {
  const listed = (await request<{ agents?: ApiAgent[] }>("/agents")).agents ?? [];
  return ok(listed.length
    ? listed.map((agent) => `@${agent.handle}: ${agent.role || agent.name}`).join("\n")
    : "No custom agents are available. Use the workspace agent.");
});

server.registerTool("list_threads", {
  description: "List recent Remy threads and their current state.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async () => {
  const [threads, snapshot] = await Promise.all([
    request<{ chats?: ApiThread[] }>("/chats"),
    board(),
  ]);
  const listed = threads.chats ?? [];
  return ok(listed.slice(0, 50).map((thread) => {
    const owner = snapshot.agents?.find((entry) => entry.id === thread.agentId)?.handle;
    return `${thread.id} [${thread.state}] ${thread.title}\n${thread.cwd}${owner ? `\n@${owner}` : ""}`;
  }).join("\n\n") || "There are no threads on this machine.");
});

server.registerTool("read_thread", {
  description: "Read a Remy thread's state and recent activity.",
  inputSchema: { thread_id: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async ({ thread_id }) => {
  const [thread, snapshot] = await Promise.all([
    request<ApiThread>(`/chats/${encodeURIComponent(thread_id)}`),
    board(),
  ]);
  return ok(describeThread(thread, snapshot.agents ?? []));
});

server.registerTool("start_thread", {
  description: "Start another Remy thread and send it its first message.",
  inputSchema: {
    prompt: z.string().min(1).max(20000).describe("The complete task for the new thread"),
    workspace: z.string().optional().describe("Registered workspace name, id, path, or origin. Omit it to use this thread's folder."),
    agent: z.string().optional().describe("Agent handle. Omit it to use the workspace agent."),
    title: z.string().max(120).optional(),
    provider: z.enum(["claude", "codex", "cursor"]).optional(),
    model: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ prompt, workspace, agent, title, provider, model }) => {
  const snapshot = await board();
  const handle = agent?.replace(/^@/, "");
  const selected = handle ? snapshot.agents?.find((entry) => entry.handle === handle) : undefined;
  if (agent && !selected) throw new Error(`No agent called ${agent}.`);
  const created = await request<{ chat: ApiThread }>("/chats", {
    method: "POST",
    body: {
      cwd: await workspacePath(workspace),
      title: title?.trim() || prompt.split("\n")[0]?.trim().slice(0, 120),
      ...(selected ? { agentId: selected.id } : {}),
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
    },
  });
  await request(`/chats/${encodeURIComponent(created.chat.id)}/message`, {
    method: "POST",
    body: { text: prompt },
  });
  return ok(`Started ${created.chat.title} as thread ${created.chat.id}.`, {
    kind: "thread",
    id: created.chat.id,
    title: created.chat.title,
    detail: created.chat.cwd,
  });
});

server.registerTool("send_to_thread", {
  description: "Send another message to an existing Remy thread.",
  inputSchema: { thread_id: z.string(), message: z.string().min(1).max(20000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ thread_id, message }) => {
  if (thread_id === chatId) throw new Error("Reply normally instead of sending a message to this same thread.");
  await request(`/chats/${encodeURIComponent(thread_id)}/message`, { method: "POST", body: { text: message } });
  return ok(`Sent the message to thread ${thread_id}.`);
});

server.registerTool("stop_thread", {
  description: "Stop an existing Remy thread while keeping its conversation.",
  inputSchema: { thread_id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
}, async ({ thread_id }) => {
  if (thread_id === chatId) throw new Error("The current thread cannot stop itself through Remy.");
  await request(`/chats/${encodeURIComponent(thread_id)}/stop`, { method: "POST" });
  return ok(`Stopped thread ${thread_id}.`);
});

server.registerTool("create_ticket", {
  description: "Write a new ticket on a workspace's board.",
  inputSchema: {
    title: z.string().min(1).max(200),
    body: z.string().max(20000).optional().describe("The description in markdown"),
    workspace: z.string().optional().describe("Registered workspace name, id, path, or origin. Omit it to use this thread's folder."),
    status: z.enum(["backlog", "todo", "in_progress", "needs_input", "pr_review", "done", "cancelled"]).optional().describe("Defaults to Backlog."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ title, body, workspace, status }) => {
  const held = await workspaceFor(workspace);
  const snapshot = await board();
  const project = held && snapshot.projects?.find((entry) => entry.workspaceIds?.includes(held.id));
  if (!project) throw new Error("That folder has no board yet. Register it as a workspace first.");
  const created = await request<{ ticket: ApiTicket }>("/tickets", {
    method: "POST",
    body: {
      projectId: project.id,
      title,
      ...(body ? { body } : {}),
      ...(status ? { status } : {}),
      actor: agentId,
    },
  });
  return ok(`Created ${created.ticket.key} in ${project.name}.`, ticketCard(created.ticket));
});

server.registerTool("read_ticket", {
  description: "Read a ticket's current scope, status, sub-tickets, and recent activity.",
  inputSchema: { key },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async ({ key: asked }) => ok(await describe(asked)));

server.registerTool("attach_ticket", {
  description: "Link this thread to a ticket before working on it.",
  inputSchema: { key: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ key: asked }) => {
  const { ticket } = await ticketFor(asked);
  await request(`/tickets/${encodeURIComponent(ticket.id)}/threads`, {
    method: "POST",
    body: {
      chatId,
      deviceId: threadDeviceId,
      state: "working",
      linkedBy: "runner",
      ...(agentId ? { agentId } : {}),
    },
  });
  return ok(`Linked this thread to ${ticket.key}.`, ticketCard(ticket));
});

server.registerTool("update_ticket", {
  description: "Rewrite a ticket's title or product scope.",
  inputSchema: {
    key,
    title: z.string().max(200).optional(),
    body: z.string().max(20000).optional().describe("The complete replacement description in markdown"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ key: asked, title, body }) => {
  const { ticket } = await ticketFor(asked);
  const patch: Record<string, unknown> = {};
  if (title !== undefined) patch.title = title;
  if (body !== undefined) patch.body = body;
  if (Object.keys(patch).length === 0) throw new Error("Give a title or description to update.");
  await request(`/tickets/${encodeURIComponent(ticket.id)}`, { method: "PATCH", body: patch });
  return ok(`Updated ${ticket.key}.`, ticketCard(ticket));
});

server.registerTool("set_ticket_status", {
  description: "Move a ticket when its real work state changes.",
  inputSchema: {
    key,
    status: z.enum(["backlog", "todo", "in_progress", "needs_input", "pr_review", "done", "cancelled"]),
    note: z.string().max(10000).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ key: asked, status, note }) => {
  const { ticket } = await ticketFor(asked);
  await request(`/tickets/${encodeURIComponent(ticket.id)}/status`, {
    method: "POST",
    body: { status, note, actor: agentId },
  });
  return ok(`Moved ${ticket.key} to ${status}.`, { ...ticketCard(ticket), detail: status });
});

server.registerTool("comment_on_ticket", {
  description: "Record a concise progress note, QA result, blocker, or decision on a ticket.",
  inputSchema: { key, body: z.string().max(10000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ key: asked, body }) => {
  const { ticket } = await ticketFor(asked);
  await request(`/tickets/${encodeURIComponent(ticket.id)}/comment`, {
    method: "POST",
    body: { body, actor: agentId },
  });
  return ok(`Commented on ${ticket.key}.`, ticketCard(ticket));
});

server.registerTool("create_sub_ticket", {
  description: "Create a smaller piece of work beneath a ticket.",
  inputSchema: { key, title: z.string().max(200), body: z.string().max(20000).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ key: asked, title, body }) => {
  const { ticket } = await ticketFor(asked);
  const created = await request<{ ticket: ApiTicket }>("/tickets", {
    method: "POST",
    body: {
      projectId: ticket.projectId,
      parentId: ticket.id,
      title,
      ...(body ? { body } : {}),
      actor: agentId,
    },
  });
  return ok(`Created ${created.ticket.key} under ${ticket.key}.`, ticketCard(created.ticket));
});

server.registerTool("handoff_ticket", {
  description: "Assign a ticket to one of this agent's configured handoff targets.",
  inputSchema: { key, handle: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async ({ key: asked, handle }) => {
  const { ticket, board: snapshot } = await ticketFor(asked);
  const current = snapshot.agents?.find((entry) => entry.id === agentId);
  const next = snapshot.agents?.find((entry) => entry.handle === handle);
  if (!next) throw new Error(`No agent called @${handle}.`);
  if (!current?.handoffTo.includes(next.handle)) throw new Error(`@${current?.handle ?? "workspace"} cannot hand tickets to @${next.handle}.`);
  await request(`/tickets/${encodeURIComponent(ticket.id)}/handoff`, {
    method: "POST",
    body: { agentId: next.id, actor: current.handle },
  });
  return ok(`Handed ${ticket.key} to @${next.handle} in Todo.`, { ...ticketCard(ticket), detail: "Todo" });
});

await server.connect(new StdioServerTransport());
