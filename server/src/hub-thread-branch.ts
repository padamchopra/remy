import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getKv, setKv } from "./db.js";

const exec = promisify(execFile);
const reads = new Map<string, {at: number; pending?: Promise<string | undefined>}>();
const key = (cwd: string) => `hubThreadBranch:${cwd}`;

export async function refreshHubThreadBranch(cwd: string): Promise<string | undefined> {
  const active = reads.get(cwd)?.pending;
  if (active) return active;
  const record = {at: Date.now(), pending: undefined as Promise<string | undefined> | undefined};
  reads.set(cwd, record);
  record.pending = (async () => {
    try {
      const {stdout} = await exec("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {timeout: 5000});
      const name = stdout.trim();
      const branch = name === "HEAD" ? "detached" : name;
      if (branch) setKv(key(cwd), branch);
      return branch || undefined;
    } catch {
      return getKv<string>(key(cwd));
    } finally {
      record.pending = undefined;
    }
  })();
  return record.pending;
}

/// Keep the last confirmed checkout in snapshots, including while its computer
/// is offline. Git reads stay outside streaming and are shared by checkout.
export function hubThreadBranch(cwd: string, changed: () => void, force = false): string | undefined {
  const branch = getKv<string>(key(cwd));
  if (force || reads.get(cwd)?.pending || Date.now() - (reads.get(cwd)?.at ?? 0) >= 8000) {
    void refreshHubThreadBranch(cwd).then(next => { if (next !== branch) changed(); });
  }
  return branch;
}
