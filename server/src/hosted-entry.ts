import { mkdirSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";

const raw = process.env.REMY_HOSTED_BOOTSTRAP;
if (!raw) throw new Error("Hosted computer configuration is missing.");
delete process.env.REMY_HOSTED_BOOTSTRAP;
const bootstrap = JSON.parse(raw) as {
  registration: Record<string, unknown> & { computerId: string; organizationId: string; hubUrl: string };
  privateKey: string;
  taskId?:string;
  workspace: { id?: string; name: string; origin: string };
};
process.env.MC_CONFIG_DIR ??= "/data/remy";
mkdirSync(process.env.MC_CONFIG_DIR, { recursive: true });
mkdirSync("/workspace", { recursive: true });
if(bootstrap.taskId)process.env.REMY_HOSTED_TASK="1";
else delete process.env.REMY_HOSTED_TASK;
process.env.CODEX_HOME = "/data/codex";
process.env.CLAUDE_CONFIG_DIR = "/data/claude";
mkdirSync(process.env.CODEX_HOME, { recursive: true });
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
const { setKv, getKv } = await import("./db.js");
const { configureHostedCodex } = await import("./hosted-codex-account.js");
configureHostedCodex(process.env.CODEX_HOME, getKv<boolean>("hostedCodexConnected") === true);
setKv("deviceId", bootstrap.registration.computerId);
setKv("hubComputerPrivateKey", bootstrap.privateKey);
setKv("hubComputerRegistration", bootstrap.registration);
setKv("config", {
  ...getKv<Record<string, unknown>>("config"),
  hubMode: true,
  defaultProvider: process.env.ANTHROPIC_API_KEY ? "claude" : "codex",
  deviceName: `Hosted ${bootstrap.workspace.name}`,
});
if (bootstrap.workspace.id) {
  setKv("hostedWorkspaceId", bootstrap.workspace.id);
  setKv("hostedWorkspaceRepository", { path: "/workspace", origin: bootstrap.workspace.origin });
  const registration = bootstrap.registration as {
    organizationId: string;
    hubUrl: string;
  };
  const remote = new URL(
    `/api/organizations/${encodeURIComponent(registration.organizationId)}/git/${encodeURIComponent(bootstrap.workspace.id)}`,
    registration.hubUrl,
  ).href;
  const helper = new URL("./hosted-git-helper.js", import.meta.url).pathname;
  chmodSync(helper, 0o755);
  execFileSync("git", ["init", "-q", "/workspace"], { stdio: "ignore" });
  for (const args of [
    ["credential.helper", ""],
    ["--add", "credential.helper", helper],
    ["credential.useHttpPath", "true"],
    ["remote.origin.url", remote],
  ])
    execFileSync("git", ["-C", "/workspace", "config", "--local", ...args], {
      stdio: "ignore",
    });
  try {
    execFileSync("git", ["-C", "/workspace", "rev-parse", "--verify", "HEAD"], {
      stdio: "ignore",
    });
  } catch {
    execFileSync("git", ["-C", "/workspace", "fetch", "--depth=1", "origin"], {
      stdio: "ignore",
      env: {
        ...process.env,
        REMY_GIT_READ_ONLY: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    });
    execFileSync(
      "git",
      ["-C", "/workspace", "checkout", "--detach", "FETCH_HEAD"],
      { stdio: "ignore" },
    );
  }
} else {
  execFileSync("git", ["init", "-q", "/workspace"], { stdio: "ignore" });
}
const { addWorkspace } = await import("./workspaces.js");
await addWorkspace(bootstrap.workspace.name, "/workspace");
await import("./index.js");

const { resumeCheckpointTurns } = await import("./hosted-turns.js");
const { sendChatMessage } = await import("./chat.js");
void resumeCheckpointTurns(
  getKv<import("./hosted-turns.js").CheckpointTurn[]>("hostedCheckpointTurns") ?? [],
  turns => setKv("hostedCheckpointTurns", turns),
  (id, prompt, messageId) => sendChatMessage(id, prompt, [], [], undefined, messageId, { id: "remy", label: "Remy" }),
).catch(() => console.error("A thread could not resume after your computer restarted."));
