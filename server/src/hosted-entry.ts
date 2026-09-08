import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const raw = process.env.REMY_HOSTED_BOOTSTRAP;
if (!raw) throw new Error("Hosted computer configuration is missing.");
delete process.env.REMY_HOSTED_BOOTSTRAP;
const bootstrap = JSON.parse(raw) as {
  registration: Record<string, unknown> & { computerId: string };
  privateKey: string;
  workspace: { name: string; origin: string };
};
process.env.MC_CONFIG_DIR ??= "/data/remy";
mkdirSync(process.env.MC_CONFIG_DIR, { recursive: true });
mkdirSync("/workspace", { recursive: true });
process.env.CODEX_HOME = "/data/codex";
process.env.CLAUDE_CONFIG_DIR = "/data/claude";
mkdirSync(process.env.CODEX_HOME, { recursive: true });
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
writeFileSync(
  `${process.env.CODEX_HOME}/config.toml`,
  'model_provider = "remy_openai"\n[model_providers.remy_openai]\nname = "OpenAI"\nbase_url = "https://api.openai.com/v1"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\nrequires_openai_auth = false\n',
  { mode: 0o600 },
);
const { setKv, getKv } = await import("./db.js");
setKv("deviceId", bootstrap.registration.computerId);
setKv("hubComputerPrivateKey", bootstrap.privateKey);
setKv("hubComputerRegistration", bootstrap.registration);
setKv("config", {
  ...getKv<Record<string, unknown>>("config"),
  hubMode: true,
  defaultProvider: process.env.ANTHROPIC_API_KEY ? "claude" : "codex",
  deviceName: `Hosted ${bootstrap.workspace.name}`,
});
try {
  execFileSync("git", ["-C", "/workspace", "rev-parse", "--git-dir"], {
    stdio: "ignore",
  });
} catch {
  execFileSync("git", ["init", "-q", "/workspace"], { stdio: "ignore" });
  execFileSync(
    "git",
    [
      "-C",
      "/workspace",
      "remote",
      "add",
      "origin",
      `https://${bootstrap.workspace.origin}.git`,
    ],
    { stdio: "ignore" },
  );
}
const { addWorkspace } = await import("./workspaces.js");
await addWorkspace(bootstrap.workspace.name, "/workspace");
await import("./index.js");
