import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../..", import.meta.url));
const computer = spawn(process.execPath, [join(root, "hub/scripts/qa-threads.mjs")], {
  cwd: root,
  env: {
    ...process.env,
    QA_HUB_WEB: "1",
    QA_COMPUTER_POLICY: "1",
    QA_ENV_FILE: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
computer.stderr.pipe(process.stderr);

let session;
let hub;
let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});
const lines = createInterface({ input: computer.stdout });
lines.on("line", (line) => {
  if (line.startsWith("QA_SESSION=")) session = line.slice("QA_SESSION=".length);
  if (line.startsWith("QA_HUB=")) hub = line.slice("QA_HUB=".length).split(" ")[0];
  if (!line.startsWith('{"event":"request.outcome"')) process.stdout.write(`${line}\n`);
  if (session && hub) readyResolve();
});
computer.once("exit", (code, signal) => {
  if (!session || !hub) readyReject(new Error(`The QA computer exited before it was ready (${code ?? signal}).`));
});

const timeout = setTimeout(
  () => readyReject(new Error("The QA computer did not become ready within 60 seconds.")),
  60_000,
);
try {
  await ready;
  clearTimeout(timeout);
  const journey = spawn(process.execPath, [join(root, "web/scripts/qa-hub-threads.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      QA_SESSION: session,
      QA_WEB_URL: hub,
      QA_ARTIFACTS: process.env.QA_ARTIFACTS ?? "/tmp/remy-pr-artifacts/thread-journey",
    },
    stdio: "inherit",
  });
  const [code, signal] = await once(journey, "exit");
  if (code !== 0) throw new Error(`The thread journey failed (${code ?? signal}).`);
} finally {
  clearTimeout(timeout);
  lines.close();
  if (computer.exitCode === null && computer.signalCode === null) {
    computer.kill("SIGINT");
    await Promise.race([
      once(computer, "exit"),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
    if (computer.exitCode === null && computer.signalCode === null) computer.kill("SIGTERM");
  }
}
