import {hubGitHubInput} from "./hub-github-input.js";
import { PROPOSE_REVIEW_RULE, proposeReviewRuleInput, REPORT_REVIEW_FINDINGS, reportReviewFindingsInput, reviewToolText, type ReviewTool } from "./review-tools.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { basename } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { REMY_TOOL_INSTRUCTIONS } from "./ticket-tool-contract.js";
import { artifactMarker, type ConvArtifact } from "./remy-artifacts.js";

interface ApiWorkspace {
  id: string;
  name: string;
  path: string;
  origin?: string | null;
  worktrees?: { path: string }[];
}

interface ApiThread {
  id: string;
  title: string;
  cwd: string;
  state: string;
  provider: string;
  model?: string;
  preview?: string;
  entries?: {
    kind: string;
    text?: string;
    verb?: string;
    arg?: string;
    status?: string;
  }[];
}

interface ApiBrowserView {
  title?: string;
  url?: string;
  width: number;
  height: number;
}

const apiUrl = process.env.REMY_API_URL ?? "http://127.0.0.1:8420";
const token = process.env.REMY_API_TOKEN
  ?? (process.env.REMY_MCP_PROVIDER
    ? (await import("./external-mcp-auth.js")).externalMcpToken(process.env.REMY_MCP_PROVIDER)
    : undefined)
  ?? "";
const chatId = process.env.REMY_CHAT_ID ?? "";

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

/// A tool's answer, and the card the feed draws under it. Same marker the
/// in-process server uses, so a card looks the same on every provider.
function ok(text: string, artifact?: ConvArtifact) {
  return { content: [{ type: "text" as const, text: artifact ? text + artifactMarker(artifact) : text }] };
}

function browserResult(action: string, view: ApiBrowserView): string {
  return [action, `Page: ${view.title || "Untitled"}`, `URL: ${view.url || "about:blank"}`].join("\n");
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
    return listed.find((workspace) =>
      workspace.path === current.cwd || workspace.worktrees?.some((worktree) => worktree.path === current.cwd));
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

function describeThread(thread: ApiThread): string {
  const recent = (thread.entries ?? []).slice(-20).map((entry) => entry.text
    ? `- ${entry.kind}: ${entry.text}`
    : `- ${entry.kind}: ${[entry.verb, entry.arg, entry.status].filter(Boolean).join(" ")}`);
  return [
    `${thread.title} (${thread.id})`,
    `State: ${thread.state}`,
    `Workspace folder: ${thread.cwd}`,
    `Provider: ${thread.provider}${thread.model ? ` / ${thread.model}` : ""}`,
    thread.preview ? `Latest: ${thread.preview}` : "",
    recent.length ? `\nRecent thread activity:\n${recent.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

const server = new McpServer(
  { name: "remy", version: "1" },
  { instructions: REMY_TOOL_INSTRUCTIONS },
);

// A review thread reports to the person and never posts to GitHub.
const reviewResult = async (action: ReviewTool, input: unknown) => {
  const result = await request<Record<string, unknown> & { artifact?: ConvArtifact }>(`/organization-tools/${action}`, { method: "POST", body: input });
  return ok(reviewToolText(action, result), result.artifact);
};
if (process.env.REMY_REVIEW === "1") {
  server.registerTool("report_review_findings", { description: REPORT_REVIEW_FINDINGS, inputSchema: reportReviewFindingsInput }, async (input) => reviewResult("report_review_findings", input));
  server.registerTool("propose_review_rule", { description: PROPOSE_REVIEW_RULE, inputSchema: proposeReviewRuleInput }, async (input) => reviewResult("propose_review_rule", input));
} else server.registerTool("github_action",{description:"Create a pull request, comment or review using the linked member account.",inputSchema:hubGitHubInput},async input=>ok(JSON.stringify(await request("/organization-tools/github_action",{method:"POST",body:input}))));
for(const action of ["list_organization_computers","list_organization_workspaces"])server.registerTool(action,{description:"List organization resources visible to the person.",inputSchema:{}},async()=>ok(JSON.stringify(await request(`/organization-tools/${action}`,{method:"POST",body:{}}))));
for(const action of ["start_organization_thread","move_organization_thread"])server.registerTool(action,{description:"Act within the person's visible organization workspaces.",inputSchema:{workspaceId:z.string(),prompt:z.string().optional(),title:z.string().optional(),threadId:z.string().optional(),computerId:z.string().optional()}},async input=>{const result=await request<{artifact?:ConvArtifact}>(`/organization-tools/${action}`,{method:"POST",body:input});return ok(JSON.stringify(result),result.artifact);});
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
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
  description: "Open a page in this thread's shared browser. The result confirms the loaded title and URL.",
  inputSchema: { url: z.string().min(1).max(4000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ url }) => {
  const view = await request<ApiBrowserView>(`${browserPath}/open`, { method: "POST", body: { url } });
  return ok(browserResult("Opened the page.", view));
});

server.registerTool("browser_viewport", {
  description: "Switch the shared browser between fullscreen, desktop, and mobile responsive layouts.",
  inputSchema: { viewport: z.enum(["fullscreen", "desktop", "mobile"]) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ viewport }) => {
  const view = await request<{ width: number; height: number }>(`${browserPath}/viewport`, {
    method: "POST",
    body: { viewport },
  });
  return ok(`Switched the shared browser to ${viewport} (${view.width} × ${view.height}).`);
});

server.registerTool("browser_back", {
  description: "Go back in the shared browser and confirm the resulting page.",
  inputSchema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async () => {
  const view = await request<ApiBrowserView>(`${browserPath}/back`, { method: "POST" });
  return ok(browserResult("Went back.", view));
});

server.registerTool("browser_forward", {
  description: "Go forward in the shared browser and confirm the resulting page.",
  inputSchema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async () => {
  const view = await request<ApiBrowserView>(`${browserPath}/forward`, { method: "POST" });
  return ok(browserResult("Went forward.", view));
});

server.registerTool("browser_reload", {
  description: "Reload the shared browser and confirm the resulting page.",
  inputSchema: {},
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => {
  const view = await request<ApiBrowserView>(`${browserPath}/reload`, { method: "POST" });
  return ok(browserResult("Reloaded the page.", view));
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
  const view = await request<ApiBrowserView>(`${browserPath}/click`, { method: "POST", body: target });
  return ok(browserResult("Clicked the page.", view));
});

server.registerTool("browser_type", {
  description: "Replace the text in a field in the shared browser. Prefer its accessible role and name.",
  inputSchema: { ...browserTarget, value: z.string().max(20000) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ value, ...target }) => {
  const view = await request<ApiBrowserView>(`${browserPath}/type`, { method: "POST", body: { ...target, value } });
  return ok(browserResult("Entered the text.", view));
});

server.registerTool("browser_press", {
  description: "Press a key or shortcut in the shared browser, such as Enter, Escape, or Meta+R.",
  inputSchema: { key: z.string().min(1).max(100) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ key }) => {
  const view = await request<ApiBrowserView>(`${browserPath}/press`, { method: "POST", body: { key } });
  return ok(browserResult(`Pressed ${key}.`, view));
});

server.registerTool("browser_scroll", {
  description: "Scroll the shared browser by pixels.",
  inputSchema: {
    delta_x: z.number().min(-10000).max(10000).optional(),
    delta_y: z.number().min(-10000).max(10000),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ delta_x, delta_y }) => {
  const view = await request<ApiBrowserView>(`${browserPath}/scroll`, { method: "POST", body: { deltaX: delta_x ?? 0, deltaY: delta_y } });
  return ok(browserResult("Scrolled the page.", view));
});

server.registerTool("browser_wait", {
  description: "Wait briefly for the shared page to update before reading it again.",
  inputSchema: { milliseconds: z.number().int().min(0).max(10000).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
}, async ({ milliseconds }) => {
  const view = await request<ApiBrowserView>(`${browserPath}/wait`, { method: "POST", body: { milliseconds: milliseconds ?? 500 } });
  return ok(browserResult("Finished waiting.", view));
});

server.registerTool("list_threads", {
  description: "List recent Remy threads and their current state.",
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async () => {
  const threads = await request<{ chats?: ApiThread[] }>("/chats");
  const listed = threads.chats ?? [];
  return ok(listed.slice(0, 50).map((thread) =>
    `${thread.id} [${thread.state}] ${thread.title}\n${thread.cwd}`,
  ).join("\n\n") || "There are no threads on this machine.");
});

server.registerTool("read_thread", {
  description: "Read a Remy thread's state and recent activity.",
  inputSchema: { thread_id: z.string() },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
}, async ({ thread_id }) => {
  const thread = await request<ApiThread>(`/chats/${encodeURIComponent(thread_id)}`);
  return ok(describeThread(thread));
});

server.registerTool("start_thread", {
  description: "Start another Remy thread and send it its first message.",
  inputSchema: {
    prompt: z.string().min(1).max(20000).describe("The complete task for the new thread"),
    workspace: z.string().optional().describe("Registered workspace name, id, path, or origin. Omit it to use this thread's folder."),
    title: z.string().max(120).optional(),
    provider: z.enum(["claude", "codex", "cursor"]).optional(),
    model: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async ({ prompt, workspace, title, provider, model }) => {
  const created = await request<{ chat: ApiThread }>("/chats", {
    method: "POST",
    body: {
      cwd: await workspacePath(workspace),
      title: title?.trim() || prompt.split("\n")[0]?.trim().slice(0, 120),
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

await server.connect(new StdioServerTransport());
