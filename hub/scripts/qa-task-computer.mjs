import { mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const input = JSON.parse(process.env.QA_TASK_INPUT);
delete process.env.QA_TASK_INPUT;
const bootstrap = JSON.parse(input.environment.REMY_HOSTED_BOOTSTRAP);
mkdirSync(process.env.MC_CONFIG_DIR, { recursive: true });
const root = realpathSync(process.env.MC_CONFIG_DIR);
const workspacePath = join(root, "workspace");
mkdirSync(workspacePath, { recursive: true });
execFileSync("git", ["init", "-q", workspacePath]);
execFileSync("git", [
  "-C",
  workspacePath,
  "config",
  "remote.origin.url",
  bootstrap.workspace.origin,
]);
const { setKv } = await import("../../server/dist/db.js");
setKv("deviceId", bootstrap.registration.computerId);
setKv("hostedWorkspaceId", bootstrap.workspace.id);
setKv("hubComputerPrivateKey", bootstrap.privateKey);
const { patchSettings } = await import("../../server/dist/config.js");
patchSettings({ notifySelf: false, defaultProvider: "claude" });
const { addWorkspace } = await import("../../server/dist/workspaces.js");
const workspace = await addWorkspace(bootstrap.workspace.name, workspacePath);
const { setProviderAdapterForTest } =
  await import("../../server/dist/provider-adapters/index.js");
setProviderAdapterForTest({
  id: "claude",
  discover: () => true,
  createSession(options, handlers) {
    return {
      close() {},
      turn() {
        return {
          interrupt() {},
          done: (async () => {
            handlers.event({ type: "turn.started" });
            writeFileSync(
              join(workspacePath, "task-proof.txt"),
              bootstrap.registration.computerId,
            );
            handlers.event({
              type: "entry.updated",
              entry: {
                id: crypto.randomUUID(),
                kind: "assistant",
                text:
                  options.env?.QA_GREETING === "disposable-environment-value"
                    ? "Your assigned environment is applied."
                    : "No assigned environment value.",
              },
            });
            handlers.event({ type: "turn.completed" });
          })(),
        };
      },
    };
  },
});
const { HubComputerConnection } =
  await import("../../server/dist/hub-computer.js");
const registration = {
  ...bootstrap.registration,
  hubUrl: process.env.QA_TASK_HUB,
};
setKv("hubComputerRegistration", registration);
const connection = new HubComputerConnection(registration, async () => ({
  ...registration.capabilities,
  workspaces: [
    {
      id: workspace.id,
      name: workspace.name,
      path: workspacePath,
      origin: bootstrap.workspace.origin,
    },
  ],
}));
connection.start();
process.on("SIGTERM", () => {
  connection.stop();
  process.exit(0);
});
await new Promise(() => {});
