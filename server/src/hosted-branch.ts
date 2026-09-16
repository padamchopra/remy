import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

export async function prepareHostedBranch(cwd: string, branch: string): Promise<void> {
  const git = (...args: string[]) => run("git", args, { cwd, timeout: 25_000, env: { ...process.env, REMY_GIT_READ_ONLY: "1", GIT_TERMINAL_PROMPT: "0" } });
  await git("check-ref-format", "--branch", branch);
  const current = await git("branch", "--show-current");
  if (current.stdout.trim() === branch) return;
  await git("fetch", "--depth=1", "origin", `refs/heads/${branch}`);
  let exists = false;
  try { await git("show-ref", "--verify", `refs/heads/${branch}`); exists = true; } catch {}
  if (exists) await git("checkout", branch);
  else await git("checkout", "-b", branch, "FETCH_HEAD");
}
