import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = join(root, "server");
const webDir = join(root, "web");
const args = new Set(process.argv.slice(2));

if (args.has("--help")) {
  console.log(`Usage: npm run qa:web -- [--empty] [--check]

Runs the current checkout's server and web UI beside the packaged Remy app.
The sidecar uses random loopback ports and disposable state, and removes it on exit.

  --empty  Do not create the sample workspace and ticket
  --check  Start, verify the UI and API proxy, then exit`);
  process.exit(0);
}

const unknown = [...args].filter((arg) => arg !== "--empty" && arg !== "--check");
if (unknown.length) {
  console.error(`Unknown option: ${unknown.join(", ")}`);
  process.exit(2);
}

const qaRoot = mkdtempSync(join(tmpdir(), "remy-qa-"));
const stateDir = join(qaRoot, "state");
const sampleDir = join(qaRoot, "sample-workspace");
const children = [];
let cleaning = false;

function cleanEnvironment(overrides = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("REMY_") || name.startsWith("MC_")) delete env[name];
  }
  return { ...env, ...overrides };
}

function run(program, programArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(program, programArgs, {
      cwd: options.cwd ?? root,
      env: options.env ?? cleanEnvironment(),
      stdio: options.stdio ?? "inherit",
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${program} exited with ${code ?? signal}${stderr ? `\n${stderr.trim()}` : ""}`));
    });
  });
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        rejectPort(new Error("Could not reserve a QA port."));
        return;
      }
      const port = address.port;
      probe.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

function start(name, program, programArgs, options) {
  const child = spawn(program, programArgs, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  children.push({ name, child });
  child.once("error", (error) => {
    if (!cleaning) void fail(new Error(`${name} could not start: ${error.message}`));
  });
  child.once("exit", (code, signal) => {
    if (!cleaning) void fail(new Error(`${name} stopped unexpectedly (${code ?? signal}).`));
  });
  return child;
}

async function waitFor(name, url, init = {}) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`${name} did not become ready: ${lastError instanceof Error ? lastError.message : "timed out"}`);
}

async function request(serverUrl, token, path, init = {}) {
  const response = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${body.error ?? response.statusText}`);
  return body;
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 3_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function cleanup() {
  if (cleaning) return;
  cleaning = true;
  for (const { child } of children.toReversed()) await terminate(child);
  rmSync(qaRoot, { recursive: true, force: true });
}

async function fail(error) {
  console.error(`\nQA sidecar failed: ${error.message}`);
  await cleanup();
  process.exitCode = 1;
}

async function seedSample(serverUrl, token) {
  mkdirSync(sampleDir, { recursive: true });
  writeFileSync(join(sampleDir, "README.md"), "# Sample workspace\n\nDisposable state for Remy QA.\n");
  await run("git", ["init", "--quiet"], { cwd: sampleDir, stdio: "pipe" });
  await run("git", ["config", "user.name", "Remy QA"], { cwd: sampleDir, stdio: "pipe" });
  await run("git", ["config", "user.email", "qa@localhost"], { cwd: sampleDir, stdio: "pipe" });
  await run("git", ["add", "README.md"], { cwd: sampleDir, stdio: "pipe" });
  await run("git", ["commit", "--quiet", "-m", "Seed sample workspace"], { cwd: sampleDir, stdio: "pipe" });

  const { workspace } = await request(serverUrl, token, "/workspaces", {
    method: "POST",
    body: JSON.stringify({ name: "Sample workspace", path: sampleDir }),
  });
  const board = await request(serverUrl, token, "/board");
  const project = board.projects.find((entry) => entry.workspaceIds?.includes(workspace.id));
  if (!project) throw new Error("The sample workspace did not get a board.");
  const { ticket } = await request(serverUrl, token, "/tickets", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      title: "Review the onboarding guide",
      body: "Use this disposable ticket to exercise ticket and thread behavior.",
      status: "backlog",
    }),
  });
  return ticket;
}

async function main() {
  mkdirSync(stateDir, { recursive: true });
  console.log("Building the current Remy server for isolated QA...");
  await run("npm", ["run", "build"], { cwd: serverDir });

  const serverPort = await freePort();
  let webPort = await freePort();
  while (webPort === serverPort) webPort = await freePort();
  const token = randomBytes(32).toString("hex");
  process.env.MC_CONFIG_DIR = stateDir;
  const database = await import(pathToFileURL(join(serverDir, "dist/db.js")));
  database.setKv("config", {
    port: serverPort,
    token,
    notifySelf: false,
    repoUpdate: "off",
    remyModel: "off",
    defaultPermissionMode: "plan",
  });
  database.db.close();

  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const webUrl = `http://127.0.0.1:${webPort}`;
  start("Remy QA server", process.execPath, [join(serverDir, "dist/index.js")], {
    cwd: serverDir,
    env: cleanEnvironment({ MC_CONFIG_DIR: stateDir }),
  });
  await waitFor("Remy QA server", `${serverUrl}/health`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const ticket = args.has("--empty") ? undefined : await seedSample(serverUrl, token);
  start("Remy QA web UI", process.execPath, [join(webDir, "node_modules/vite/bin/vite.js"), "--port", String(webPort), "--strictPort"], {
    cwd: webDir,
    env: cleanEnvironment({
      MC_CONFIG_DIR: stateDir,
      MC_SERVER_URL: serverUrl,
      MC_TOKEN: token,
    }),
  });
  await waitFor("Remy QA web UI", webUrl);
  const proxied = await waitFor("Remy QA API proxy", `${webUrl}/api/board`);
  const board = await proxied.json();
  if (ticket && !board.tickets.some((entry) => entry.id === ticket.id)) {
    throw new Error("The sample ticket was not available through the QA web proxy.");
  }

  console.log(`\nQA sidecar is ready: ${webUrl}/#/board`);
  console.log(ticket ? `Sample ticket: ${ticket.key} — ${ticket.title}` : "State: empty");
  console.log(`Disposable state: ${stateDir}`);
  console.log("The packaged Remy app, port 8420, and your real database are untouched.");

  if (args.has("--check")) {
    console.log("QA sidecar check passed; stopping only the sidecar processes.");
    await cleanup();
    return;
  }

  console.log("Press Ctrl+C when QA is complete.");
  await new Promise((resolveStop) => {
    process.once("SIGINT", resolveStop);
    process.once("SIGTERM", resolveStop);
  });
  await cleanup();
}

main().catch(fail);
