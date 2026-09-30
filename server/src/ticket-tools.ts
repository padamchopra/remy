import { getKv } from "./db.js";
import { startThreadInput, sendThreadInput, START_THREAD_DESCRIPTION } from "./thread-orchestration.js";
import {hubGitHubInput} from "./hub-github-input.js";
import {hubOrganizationTool} from "./hub-organization-tools.js";
import { threadReview } from "./review-agent.js";
import { PROPOSE_REVIEW_RULE, proposeReviewRuleInput, reviewToolText, type ReviewTool } from "./review-tools.js";
import { createSdkMcpServer, tool } from "./provider-adapters/claude.js";
import { basename } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { artifactMarker, type ConvArtifact } from "./remy-artifacts.js";
import { REMY_TOOL_INSTRUCTIONS } from "./ticket-tool-contract.js";
import { addWorkspace, listWorkspaces } from "./workspaces.js";
import {
  browserSnapshotText,
  clickBrowser,
  navigateBrowser,
  openBrowser,
  pressBrowser,
  scrollBrowser,
  setBrowserViewport,
  typeBrowser,
  type BrowserView,
  waitInBrowser,
} from "./browser.js";

export interface RemyThreadControl {
  runEnvironment(input: { program: string; args?: string[]; timeoutSeconds?: number }): Promise<{
    command: string;
    output: string;
    exitCode: number;
  }>;
}

/// A tool's answer, and the card the feed draws under it. The marker rides in
/// the text because that is the one thing every provider's transcript keeps.
function ok(text: string, artifact?: ConvArtifact) {
  return { content: [{ type: "text" as const, text: artifact ? text + artifactMarker(artifact) : text }] };
}

function browserResult(action: string, view: BrowserView): string {
  return [action, `Page: ${view.title || "Untitled"}`, `URL: ${view.url || "about:blank"}`].join("\n");
}

function workspaceName(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  return basename(trimmed === "~" ? homedir() : trimmed) || "Workspace";
}

export function inProcessRemyMcpServer(
  chatId: string,
  threads: RemyThreadControl,
) {
  const review = !!threadReview(chatId);
  const reviewResult = async (action: ReviewTool, input: unknown) => {
    const result = await hubOrganizationTool(chatId, action, input) as Record<string, unknown> & { artifact?: ConvArtifact };
    return ok(reviewToolText(action, result), result.artifact);
  };
  return createSdkMcpServer({
    name: "remy",
    version: "1",
    instructions: REMY_TOOL_INSTRUCTIONS,
    tools: [
      // A review thread reports to the person and never posts to GitHub.
      ...(review ? [
        tool("propose_review_rule",PROPOSE_REVIEW_RULE,proposeReviewRuleInput,async input=>reviewResult("propose_review_rule",input)),
      ] : getKv(`hubReviewDelegation:${chatId}`) ? [] : [
        tool("github_action","Create a pull request, comment or review using the linked member account.",hubGitHubInput,async input=>ok(JSON.stringify(await hubOrganizationTool(chatId,"github_action",input)))),
      ]),
      ...["list_organization_computers","list_organization_workspaces"].map(action=>tool(action,"List organization resources visible to the person.",{},async()=>ok(JSON.stringify(await hubOrganizationTool(chatId,action))))),
      tool(
        "list_workspaces",
        "List the workspace folders registered on this machine.",
        {},
        async () => {
          const workspaces = await listWorkspaces();
          return ok(workspaces.length
            ? workspaces.map((workspace) => `${workspace.name} (${workspace.id})\n${workspace.path}${workspace.origin ? `\n${workspace.origin}` : ""}`).join("\n\n")
            : "No workspaces are registered on this machine.");
        },
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
      ),
      tool(
        "register_workspace",
        "Register an existing Git repository folder as a Remy workspace.",
        {
          path: z.string().describe("Absolute or home-relative path to the repository folder"),
          name: z.string().max(80).optional().describe("Workspace name. Defaults to the folder name."),
        },
        async ({ path, name }) => {
          const workspace = await addWorkspace(name?.trim() || workspaceName(path), path);
          return ok(`Registered ${workspace.name} at ${workspace.path}.`, {
            kind: "workspace",
            id: workspace.id,
            title: workspace.name,
            detail: workspace.path,
          });
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } },
      ),
      tool(
        "run_with_environment",
        "Run a program in this thread's workspace with its environment values. Values stay in Remy and exact matches are removed from output.",
        {
          program: z.string().min(1).max(500).describe("Executable name or absolute path"),
          args: z.array(z.string().max(20000)).max(200).optional().describe("Arguments passed directly to the executable"),
          timeout_seconds: z.number().int().min(1).max(300).optional(),
        },
        async ({ program, args, timeout_seconds }) => {
          const result = await threads.runEnvironment({ program, args, timeoutSeconds: timeout_seconds });
          return ok([
            `${result.command} exited ${result.exitCode}.`,
            result.output || "The command produced no output.",
          ].join("\n\n"));
        },
        { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_open",
        "Open a page in this thread's shared browser. The result confirms the loaded title and URL.",
        { url: z.string().min(1).max(4000) },
        async ({ url }) => {
          const view = await openBrowser(chatId, url, "agent");
          return ok(browserResult("Opened the page.", view));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
      ),
      tool(
        "browser_viewport",
        "Switch the shared browser between fullscreen, desktop, and mobile responsive layouts.",
        { viewport: z.enum(["fullscreen", "desktop", "mobile"]) },
        async ({ viewport }) => {
          const view = await setBrowserViewport(chatId, viewport, "agent");
          return ok(`Switched the shared browser to ${viewport} (${view.width} × ${view.height}).`);
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
      ),
      tool(
        "browser_back",
        "Go back in the shared browser and confirm the resulting page.",
        {},
        async () => ok(browserResult("Went back.", await navigateBrowser(chatId, "back", "agent"))),
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_forward",
        "Go forward in the shared browser and confirm the resulting page.",
        {},
        async () => ok(browserResult("Went forward.", await navigateBrowser(chatId, "forward", "agent"))),
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_reload",
        "Reload the shared browser and confirm the resulting page.",
        {},
        async () => ok(browserResult("Reloaded the page.", await navigateBrowser(chatId, "reload", "agent"))),
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
      ),
      tool(
        "browser_snapshot",
        "Read the shared browser's current URL, visible text, interactive elements, console, and failed requests.",
        {},
        async () => ok(await browserSnapshotText(chatId)),
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_click",
        "Click an element or coordinate in the shared browser. Prefer an accessible role and name.",
        {
          role: z.string().max(80).optional(),
          name: z.string().max(500).optional(),
          text: z.string().max(500).optional(),
          selector: z.string().max(1000).optional(),
          x: z.number().min(0).max(2000).optional(),
          y: z.number().min(0).max(2000).optional(),
        },
        async (target) => {
          const view = await clickBrowser(chatId, target, "agent");
          return ok(browserResult("Clicked the page.", view));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_type",
        "Replace the text in a field in the shared browser. Prefer its accessible role and name.",
        {
          role: z.string().max(80).optional(),
          name: z.string().max(500).optional(),
          text: z.string().max(500).optional(),
          selector: z.string().max(1000).optional(),
          value: z.string().max(20000),
        },
        async ({ value, ...target }) => {
          const view = await typeBrowser(chatId, target, value, "agent");
          return ok(browserResult("Entered the text.", view));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
      ),
      tool(
        "browser_press",
        "Press a key or shortcut in the shared browser, such as Enter, Escape, or Meta+R.",
        { key: z.string().min(1).max(100) },
        async ({ key }) => {
          const view = await pressBrowser(chatId, key, "agent");
          return ok(browserResult(`Pressed ${key}.`, view));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_scroll",
        "Scroll the shared browser by pixels.",
        {
          delta_x: z.number().min(-10000).max(10000).optional(),
          delta_y: z.number().min(-10000).max(10000),
        },
        async ({ delta_x, delta_y }) => {
          const view = await scrollBrowser(chatId, delta_x ?? 0, delta_y, "agent");
          return ok(browserResult("Scrolled the page.", view));
        },
        { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      ),
      tool(
        "browser_wait",
        "Wait briefly for the shared page to update before reading it again.",
        { milliseconds: z.number().int().min(0).max(10000).optional() },
        async ({ milliseconds }) => {
          const view = await waitInBrowser(chatId, milliseconds ?? 500, "agent");
          return ok(browserResult("Finished waiting.", view));
        },
        { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true } },
      ),
      tool("list_threads", "List accessible, unarchived threads across your connected computers, including idle threads.", {}, async () => ok(JSON.stringify(await hubOrganizationTool(chatId,"list_threads"))), { annotations: { readOnlyHint: true, destructiveHint: false } }),
      tool("read_thread", "Read an accessible thread's state and recent messages.", {thread_id:z.string().uuid()}, async input => ok(JSON.stringify(await hubOrganizationTool(chatId,"read_thread",input))), { annotations: { readOnlyHint: true, destructiveHint: false } }),
      tool("start_thread", START_THREAD_DESCRIPTION, startThreadInput, async input => {
        const result = await hubOrganizationTool(chatId,"start_thread",input) as {artifact?:ConvArtifact};
        return ok(JSON.stringify(result),result.artifact);
      }, { annotations: { readOnlyHint: false, destructiveHint: false } }),
      tool("send_to_thread", "Send a message as this agent to an accessible thread you can write to; its sender links back to this thread.", sendThreadInput, async input => {
        await hubOrganizationTool(chatId,"send_to_thread",input);
        return ok(`Sent the message to thread ${input.thread_id}.`);
      }, { annotations: { readOnlyHint: false, destructiveHint: false } }),
      tool(
        "stop_thread",
        "Stop an existing Remy thread while keeping its conversation.",
        { thread_id: z.string() },
        async ({ thread_id }) => {
          if (thread_id === chatId) throw new Error("The current thread cannot stop itself through Remy.");
          await hubOrganizationTool(chatId,"stop_thread",{thread_id});
          return ok(`Stopped thread ${thread_id}.`);
        },
        { annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
      ),
    ],
  });
}
