import { z } from "zod";
export const startThreadInput = {
  prompt: z.string().min(1).max(20000).describe("The complete task for the new thread"),
  title: z.string().max(120).optional(),
  workspace: z.string().optional().describe("Workspace id, name, path, or origin on this computer; defaults to the current folder"),
  provider: z.enum(["claude", "codex", "cursor"]).optional(), model: z.string().max(512).optional(),
  effort: z.string().max(64).optional(),
  permissionMode: z.enum(["default", "auto", "acceptEdits", "plan", "bypassPermissions"]).optional(),
  visibility: z.enum(["private", "open"]).optional(),
  request_id: z.string().uuid().optional().describe("Reuse this id when retrying the same start"),
};
export const sendThreadInput = { thread_id: z.string().uuid(), message: z.string().min(1).max(20000), message_id: z.string().uuid().optional().describe("Reuse this id when retrying the same message") };
export const START_THREAD_DESCRIPTION = "Start a thread with this thread's computer, folder, provider, model, reasoning level, permissions, and visibility unless overridden. Permission overrides can only keep or narrow the current permissions. Its first message is labelled with this agent's identity. Reuse request_id on retry.";
