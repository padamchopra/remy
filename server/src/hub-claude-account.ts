import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getKv, setKv } from "./db.js";
import { rememberSecrets } from "./environments.js";

/// Claude Code account credentials someone connected from the web for this
/// computer. The file is what Claude Code reads; the environment copy is
/// dropped so child processes do not inherit it.
const STORED = "hubClaudeAccount";
const VALUE_LIMIT = 32_768;

function credentialsPath() {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), ".credentials.json");
}

function tokenValues(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as { claudeAiOauth?: { accessToken?: unknown; refreshToken?: unknown } };
    return [parsed.claudeAiOauth?.accessToken, parsed.claudeAiOauth?.refreshToken].filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function writeCredentials(json: string): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json, { mode: 0o600 });
}

function removeCredentials(): void {
  try { unlinkSync(credentialsPath()); } catch { /* already gone */ }
}

/// Accepts the hub-delivered Claude account for this computer, and says whether
/// it changed so a running thread can be given the new session.
export function applyHubClaudeAccount(input: unknown): boolean {
  const delivered = (input as { claudeCredentials?: unknown } | null)?.claudeCredentials;
  if (delivered === undefined) return false;
  if (delivered === null || delivered === "") {
    if (!getKv(STORED)) return false;
    setKv(STORED, null);
    rememberSecrets("hub-claude-account", []);
    removeCredentials();
    delete process.env.CLAUDE_CREDENTIALS_JSON;
    return true;
  }
  if (typeof delivered !== "string" || !delivered || delivered.length > VALUE_LIMIT) throw new Error("Your Claude account could not be read.");
  JSON.parse(delivered);
  if (getKv<string>(STORED) === delivered) return false;
  setKv(STORED, delivered);
  rememberSecrets("hub-claude-account", tokenValues(delivered));
  writeCredentials(delivered);
  delete process.env.CLAUDE_CREDENTIALS_JSON;
  return true;
}

export function restoreHubClaudeAccount(): void {
  const stored = getKv<string>(STORED);
  if (!stored) return;
  rememberSecrets("hub-claude-account", tokenValues(stored));
  writeCredentials(stored);
  delete process.env.CLAUDE_CREDENTIALS_JSON;
}

export function forgetHubClaudeAccount(): void {
  if (!getKv(STORED)) return;
  setKv(STORED, null);
  rememberSecrets("hub-claude-account", []);
  removeCredentials();
  delete process.env.CLAUDE_CREDENTIALS_JSON;
}
