import type { ProviderModel, ProviderId } from "../providers.js";
import type { ConvEntry, ConvQuestion, ConvTodo } from "../transcript.js";

export type ProviderPermissionMode =
  | "default"
  | "auto"
  | "acceptEdits"
  | "plan"
  | "bypassPermissions";

export interface ProviderMcpProcess {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ProviderSessionOptions {
  command: string;
  cwd: string;
  model?: string;
  effort?: string;
  permissionMode: ProviderPermissionMode;
  sessionId?: string;
  additionalDirectories?: string[];
  developerInstructions?: string;
  inProcessMcp?: unknown;
  mcpProcess?: ProviderMcpProcess;
  env?: NodeJS.ProcessEnv;
  entries?: readonly ConvEntry[];
}

export interface ProviderImage {
  dataUrl: string;
  base64: string;
  mimeType: string;
}

export interface ProviderTurn {
  prompt: string;
  images: ProviderImage[];
  model?: string;
  effort?: string;
  permissionMode: ProviderPermissionMode;
}

export interface ProviderRun {
  done: Promise<void>;
  interrupt(): void;
}

export interface ProviderSession {
  turn(input: ProviderTurn): ProviderRun;
  close(): void;
}

export interface ProviderApprovalRequest {
  tool: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  title?: string;
  reason?: string;
  allowAlways: boolean;
  trusted?: boolean;
  edit?: boolean;
}

export interface ProviderQuestionRequest {
  questions: ConvQuestion[];
  signal: AbortSignal;
}

export type ProviderApprovalDecision = "allow" | "allowAlways" | "deny";

export interface ProviderHandlers {
  event(event: ProviderEvent): void;
  approve?(request: ProviderApprovalRequest): Promise<ProviderApprovalDecision>;
  answer?(request: ProviderQuestionRequest): Promise<Record<string, unknown>>;
}

export type ProviderEvent =
  | { type: "session.started"; sessionId: string }
  | { type: "session.closed" }
  | { type: "turn.started" }
  | { type: "turn.completed"; turns?: number; costUsd?: number }
  | { type: "turn.failed"; error: string }
  | { type: "entry.updated"; entry: ConvEntry }
  | { type: "todos.updated"; todos: ConvTodo[] }
  | { type: "usage.updated"; tokens: number; model?: string; limit?: number; costUsd?: number }
  | { type: "compacted" };

export interface ProviderAnswerOptions {
  command: string;
  prompt: string;
  cwd: string;
  model?: string;
  effort?: string;
  timeoutMs: number;
  systemPrompt?: string;
  developerInstructions?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  createSession(options: ProviderSessionOptions, handlers: ProviderHandlers): ProviderSession;
  answer(options: ProviderAnswerOptions): Promise<string | undefined>;
  discoverModels(): Promise<ProviderModel[]>;
  errorMessage?(message: string): string;
}
