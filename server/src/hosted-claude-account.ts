import { writeFileSync } from "node:fs";
import { join } from "node:path";

/// Writes Claude Code's own credentials file from the hub-injected payload,
/// then drops the environment copy so child processes do not inherit it.
export function configureHostedClaude(home: string, credentialsJson?: string) {
  if (!credentialsJson) return;
  writeFileSync(join(home, ".credentials.json"), credentialsJson, { mode: 0o600 });
  delete process.env.CLAUDE_CREDENTIALS_JSON;
}
