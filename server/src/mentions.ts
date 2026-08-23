import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { createSdkMcpServer, query, tool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { agentCommand } from "./agent.js";
import { assignedAgent, type Agent } from "./agents.js";
import { agentEnvironment } from "./chat.js";
import { config } from "./config.js";
import { listProjects } from "./projects.js";
import { broadcast } from "./notify.js";
import {
  YOU,
  commentOnTicket,
  createTicket,
  getTicket,
  listTickets,
  ticketActivity,
  updateTicket,
  type Mention,
  type TicketView,
} from "./tickets.js";
import { listWorkspaces } from "./workspaces.js";

/// Naming an agent in a comment.
///
/// This is deliberately not the runner. A mention is a question or a small
/// instruction about the ticket — "what is the scope of this", "split this up"
/// — so the turn can read the repo and edit the ticket and nothing else. There
/// is no worktree, no branch and no thread: starting work is what moving a
/// ticket to Todo will mean, and the two should not be the same gesture.

/// How much of the ticket's story the agent is told. Enough to answer a
/// question about it; not so much that a long-running ticket costs a fortune
/// every time somebody says hello.
const RECENT_COMMENTS = 12;

const BRIEF = `You have been named in a comment on a ticket in Remy, the user's planning board.

Answer the comment. Your final message is posted back as your reply on the ticket, so write it as a comment to a colleague: plain prose, no preamble, no sign-off, and no restating of the question.

You may read the repository to answer accurately, and you may edit the ticket through the tools you have been given — rewrite its description, or split it into sub-tickets — when the comment asks you to.

You may not start the work. You have no ability to edit files, run commands, open a branch or open a thread, and that is on purpose. If the comment is asking for the work itself rather than a question about it, say what you would do and that the ticket is ready to be moved to Todo.

If you changed the ticket, say briefly what you changed. If you changed nothing, just answer.`;

async function workspacePathFor(ticket: TicketView): Promise<string | undefined> {
  const project = listProjects().find((entry) => entry.id === ticket.projectId);
  if (!project) return undefined;
  const workspace = (await listWorkspaces()).find((entry) => project.workspaceIds.includes(entry.id));
  return workspace && existsSync(workspace.path) ? workspace.path : undefined;
}

/// What the agent is told about the ticket it was named on.
function brief(ticket: TicketView, comment: string, cwd?: string): string {
  const children = listChildren(ticket);
  const story = ticketActivity(ticket.id)
    .filter((entry) => entry.kind === "comment" && entry.body)
    .slice(-RECENT_COMMENTS)
    .map((entry) => `${entry.actor === YOU ? "The user" : entry.actor}: ${entry.body}`)
    .join("\n\n");

  return [
    `Ticket ${ticket.key}: ${ticket.title}`,
    `Status: ${ticket.status}`,
    cwd ? `Repository: ${cwd}` : "The repository for this ticket is not on this machine, so you cannot read it.",
    ticket.body ? `\nDescription:\n${ticket.body}` : "\nThe ticket has no description yet.",
    children.length
      ? `\nSub-tickets:\n${children.map((child) => `- ${child.key} [${child.status}] ${child.title}`).join("\n")}`
      : "\nIt has no sub-tickets.",
    story ? `\nThe conversation so far:\n${story}` : "",
    `\nThe comment that named you:\n${comment}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function listChildren(ticket: TicketView): TicketView[] {
  return listTickets(ticket.projectId).filter((entry) => entry.parentId === ticket.id);
}

/// The only things a mention turn can change. Narrow on purpose: a mention
/// shapes the ticket, it does not move it or hand it to anybody.
function boardTools(ticketId: string) {
  return createSdkMcpServer({
    name: "remy",
    version: "1",
    tools: [
      tool(
        "update_ticket",
        "Rewrite this ticket's title or description. Use it when the comment asks you to scope, clarify or rewrite the ticket.",
        {
          title: z.string().max(200).optional().describe("A new title, if the current one is wrong"),
          body: z.string().max(20000).optional().describe("The new description, in markdown. Replaces the old one."),
        },
        async (args) => {
          const patch: Record<string, unknown> = {};
          if (args.title) patch.title = args.title;
          if (args.body !== undefined) patch.body = args.body;
          if (Object.keys(patch).length === 0) {
            return { content: [{ type: "text" as const, text: "Nothing to change." }] };
          }
          const updated = updateTicket(ticketId, patch);
          broadcast({ type: "board" });
          return { content: [{ type: "text" as const, text: `Updated ${updated.key}.` }] };
        },
      ),
      tool(
        "add_sub_ticket",
        "Break this ticket into a smaller one beneath it. Sub-tickets start in Backlog and are not assigned to anybody.",
        {
          title: z.string().max(200).describe("What the piece of work is"),
          body: z.string().max(20000).optional().describe("What it involves, in markdown"),
        },
        async (args) => {
          const parent = getTicket(ticketId);
          if (!parent) return { content: [{ type: "text" as const, text: "That ticket is gone." }] };
          const child = createTicket({
            projectId: parent.projectId,
            parentId: ticketId,
            title: args.title,
            ...(args.body ? { body: args.body } : {}),
          });
          broadcast({ type: "board" });
          return { content: [{ type: "text" as const, text: `Created ${child.key}.` }] };
        },
      ),
    ],
  });
}

/// Reading the repository, and shaping the ticket. Nothing that writes a file
/// or runs a command, so "start the work" is not reachable from a comment.
const ALLOWED = [
  "Read",
  "Grep",
  "Glob",
  "mcp__remy__update_ticket",
  "mcp__remy__add_sub_ticket",
];

async function answer(agent: Agent, ticket: TicketView, comment: string): Promise<string> {
  const cwd = await workspacePathFor(ticket);
  const model = agent.model || config.defaultModel || undefined;
  const effort = (agent.provider === "default" ? config.defaultEffort : agent.effort) || undefined;
  const instructions = agent.instructions.trim();
  const options: Options = {
    cwd: cwd ?? homedir(),
    pathToClaudeCodeExecutable: agentCommand("claude"),
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: instructions ? `${instructions}\n\n${BRIEF}` : BRIEF,
    },
    settingSources: ["user", "project", "local"],
    permissionMode: "default",
    allowedTools: ALLOWED,
    mcpServers: { remy: boardTools(ticket.id) },
    ...(model ? { model } : {}),
    ...(effort ? { effort: effort as NonNullable<Options["effort"]> } : {}),
    // Belt and braces: `allowedTools` is the allowlist, and this refuses
    // anything that reaches the callback anyway. A mention must not be a way
    // to run a command on the machine.
    canUseTool: async (name) =>
      ALLOWED.includes(name)
        ? { behavior: "allow" as const, updatedInput: {} }
        : { behavior: "deny" as const, message: "A mention can read and shape the ticket, nothing else." },
    // The whole environment, not just the git names: the CLI finds the user's
    // credentials and its own PATH through it, and handing it only two
    // variables leaves it logged out.
    env: agentEnvironment(agent),
    stderr: (data) => {
      const text = data.trim();
      if (text) console.error(`mention ${agent.handle} on ${ticket.key}: ${text}`);
    },
  };

  let reply = "";
  for await (const message of query({ prompt: brief(ticket, comment, cwd), options })) {
    if (message.type === "result" && "result" in message && typeof message.result === "string") {
      reply = message.result;
    }
  }
  return reply.trim();
}

/// Answers every agent a comment named, one turn each.
///
/// Only a comment you wrote starts a turn. An agent's own reply can name
/// another agent without two of them talking to each other until the tokens run
/// out — a handoff is a thing you ask for, not something a sentence can trigger.
export function answerMentions(ticketId: string, mentions: Mention[], comment: string, actor: string): void {
  if (actor !== YOU) return;
  const agents = mentions
    .filter((mention) => mention.id !== YOU)
    // `@workspace` answers too: it is the workspace's own model, which is the
    // one to ask when nobody has written an agent for this yet.
    .map((mention) => assignedAgent(mention.id))
    .filter((agent): agent is Agent => Boolean(agent));
  if (agents.length === 0) return;

  for (const agent of agents) {
    void (async () => {
      const ticket = getTicket(ticketId);
      if (!ticket) return;
      try {
        const reply = await answer(agent, ticket, comment);
        if (reply) {
          commentOnTicket(ticketId, reply, agent.id);
          broadcast({ type: "board" });
        }
      } catch (error) {
        console.error(`mention ${agent.handle} on ${ticket.key} failed:`, error);
        commentOnTicket(
          ticketId,
          `I couldn't answer that: ${(error as Error).message || "the turn failed"}.`,
          agent.id,
        );
        broadcast({ type: "board" });
      }
    })();
  }
}
