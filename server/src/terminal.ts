import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import * as pty from "node-pty";
import { broadcast } from "./notify.js";

export interface TerminalView {
  terminalId: string;
  active: boolean;
  cwd: string;
  output: string;
  revision: number;
  exitCode?: number;
}

interface TerminalSession {
  terminalId: string;
  process: pty.IPty;
  cwd: string;
  output: string;
  pending: string;
  revision: number;
  active: boolean;
  flushTimer?: ReturnType<typeof setTimeout>;
  exitCode?: number;
}

const sessions = new Map<string, TerminalSession>();
const MAX_HISTORY = 512 * 1024;
const OUTPUT_FRAME_MS = 16;

function assertTerminalId(terminalId: string): void {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(terminalId)) throw new Error("that terminal id is not valid");
}

function size(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

/// Resolves the directory before a shell starts so a missing selection fails
/// without creating a process somewhere surprising.
export function resolveTerminalCwd(input?: string): string {
  const trimmed = input?.trim() || "~";
  const expanded = trimmed === "~"
    ? homedir()
    : trimmed.startsWith("~/")
      ? resolve(homedir(), trimmed.slice(2))
      : resolve(trimmed);
  if (!statSync(expanded).isDirectory()) throw new Error("that terminal directory is not a folder");
  return expanded;
}

function terminalEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  return env;
}

function view(session: TerminalSession): TerminalView {
  return {
    terminalId: session.terminalId,
    active: session.active,
    cwd: session.cwd,
    output: session.output + session.pending,
    revision: session.revision,
    ...(session.exitCode === undefined ? {} : { exitCode: session.exitCode }),
  };
}

function flush(session: TerminalSession): void {
  if (session.flushTimer) clearTimeout(session.flushTimer);
  session.flushTimer = undefined;
  if (!session.pending) return;
  const data = session.pending;
  session.pending = "";
  session.output = `${session.output}${data}`.slice(-MAX_HISTORY);
  session.revision += 1;
  broadcast({
    type: "terminal",
    terminalId: session.terminalId,
    active: session.active,
    cwd: session.cwd,
    revision: session.revision,
    data,
  });
}

function queueOutput(session: TerminalSession, data: string): void {
  if (!data) return;
  session.pending += data;
  if (session.flushTimer) return;
  session.flushTimer = setTimeout(() => flush(session), OUTPUT_FRAME_MS);
  session.flushTimer.unref?.();
}

/// Starts or reconnects to one server-owned terminal. Reopening the drawer
/// returns the accumulated output while leaving the shell itself untouched.
export function openTerminal(
  terminalId: string,
  input: { cwd?: string; cols?: number; rows?: number },
): TerminalView {
  assertTerminalId(terminalId);
  const cwd = resolveTerminalCwd(input.cwd);
  const cols = size(input.cols, 100, 20, 500);
  const rows = size(input.rows, 30, 5, 300);
  const existing = sessions.get(terminalId);
  if (existing?.active) {
    if (existing.cwd !== cwd) throw new Error("that terminal is already open in another folder");
    existing.process.resize(cols, rows);
    return view(existing);
  }
  if (existing) sessions.delete(terminalId);

  const shell = process.platform === "win32"
    ? process.env.ComSpec || "cmd.exe"
    : process.env.SHELL || "/bin/zsh";
  const child = pty.spawn(shell, process.platform === "win32" ? [] : ["-l"], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: terminalEnvironment(),
  });
  const session: TerminalSession = {
    terminalId,
    process: child,
    cwd,
    output: "",
    pending: "",
    revision: 0,
    active: true,
  };
  sessions.set(terminalId, session);
  child.onData((data) => queueOutput(session, data));
  child.onExit(({ exitCode }) => {
    if (sessions.get(terminalId) !== session) return;
    flush(session);
    session.active = false;
    session.exitCode = exitCode;
    session.revision += 1;
    broadcast({
      type: "terminal",
      terminalId,
      active: false,
      cwd: session.cwd,
      revision: session.revision,
      exitCode,
    });
  });
  return view(session);
}

/// Returns the latest buffered output without starting a terminal.
export function terminalView(terminalId: string): TerminalView | undefined {
  assertTerminalId(terminalId);
  const session = sessions.get(terminalId);
  if (!session) return undefined;
  flush(session);
  return view(session);
}

/// Writes a browser's input into an existing terminal process.
export function writeTerminal(terminalId: string, data: string): void {
  assertTerminalId(terminalId);
  const session = sessions.get(terminalId);
  if (!session?.active) throw new Error("that terminal is not running");
  session.process.write(data);
}

/// Keeps the PTY dimensions in step with its resizable drawer.
export function resizeTerminal(terminalId: string, cols: unknown, rows: unknown): void {
  assertTerminalId(terminalId);
  const session = sessions.get(terminalId);
  if (!session?.active) throw new Error("that terminal is not running");
  session.process.resize(size(cols, 100, 20, 500), size(rows, 30, 5, 300));
}

/// Stops and forgets one terminal; merely hiding its drawer does neither.
export function closeTerminal(terminalId: string): void {
  assertTerminalId(terminalId);
  const session = sessions.get(terminalId);
  if (!session) return;
  flush(session);
  sessions.delete(terminalId);
  session.active = false;
  session.process.kill();
  broadcast({
    type: "terminal",
    terminalId,
    active: false,
    cwd: session.cwd,
    revision: session.revision + 1,
  });
}
