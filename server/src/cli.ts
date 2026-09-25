#!/usr/bin/env node
/// The Remy command line. It signs this computer in to a Remy account with one
/// key, then runs the computer so threads can use its workspaces and providers.
///
/// A key rather than a browser: the machine holding the repositories is often
/// one you reach over SSH, and it has nowhere to open an approval page. The
/// daemon it runs still binds loopback, and pairing another device over a
/// tailnet is unchanged.
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { decodeComputerConnectionKey } from "@remy/contract";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;

const USAGE = `Remy runs your coding agents on this computer.

Usage
  remy login <key>    Connect this computer to your Remy account
  remy start          Run this computer, so your threads can use it
  remy status         Show what this computer is connected to
  remy logout         Disconnect this computer from your account
  remy --version      Print the version

Create a key in Remy on the web, under Settings → Computers → Connected.
`;

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

/// Whether this computer's Remy is already running, so a sign-in goes through
/// it rather than a second process writing the same database.
async function running(port: number, token: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ask(port: number, token: string, method: string, path: string, input?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(input ? { "content-type": "application/json" } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "This computer could not reach Remy; try again.");
  return result;
}

async function login(argv: string[]): Promise<void> {
  const value = argv.find((entry) => !entry.startsWith("-"));
  if (!value) fail("Paste your connection key: remy login <key>");
  let connection;
  try { connection = decodeComputerConnectionKey(value); }
  catch (error) { fail((error as Error).message); }

  const name = argv.includes("--name") ? argv[argv.indexOf("--name") + 1]?.trim() : undefined;
  const { config, patchSettings } = await import("./config.js");
  if (name) patchSettings({ deviceName: name.slice(0, 120) });

  const input = { hubUrl: connection.url, organizationId: connection.organizationId, ownership: connection.ownership, deviceCode: connection.key };
  if (await running(config.port, config.token)) {
    const result = await ask(config.port, config.token, "POST", "/server/hub/computer", input);
    const registration = result.registration as { name?: string } | undefined;
    say(`${registration?.name ?? (config.deviceName || hostname())} is connected to your Remy account.`);
    return;
  }

  const { registerHubComputerWithDeviceCode, stopHubComputerConnection } = await import("./hub-computer.js");
  const registration = await registerHubComputerWithDeviceCode(connection.url, connection.organizationId, connection.key, connection.ownership);
  stopHubComputerConnection();
  say(`${registration.name} is connected to your Remy account.`);
  say("Run remy start to keep it available.");
}

async function status(): Promise<void> {
  const { config } = await import("./config.js");
  const { hubComputerRegistration } = await import("./hub-computer.js");
  const registration = hubComputerRegistration();
  if (!registration) {
    say("This computer is not connected to a Remy account.");
    say("Run remy login <key> with a key from Settings → Computers → Connected.");
    return;
  }
  say(`${registration.name} is connected to ${new URL(registration.hubUrl).host}.`);
  say(`It is ${await running(config.port, config.token) ? "running" : "stopped — run remy start"}.`);
}

async function logout(): Promise<void> {
  const { config } = await import("./config.js");
  if (await running(config.port, config.token)) {
    await ask(config.port, config.token, "DELETE", "/server/hub/computer");
  } else {
    const { detachHubComputer } = await import("./hub-computer.js");
    await detachHubComputer();
  }
  say("This computer is disconnected from your Remy account.");
}

async function start(): Promise<void> {
  await import("./index.js");
}

const [command = "", ...rest] = process.argv.slice(2);
try {
  if (command === "login") { await login(rest); process.exit(0); }
  else if (command === "status") { await status(); process.exit(0); }
  else if (command === "logout") { await logout(); process.exit(0); }
  else if (command === "start") await start();
  else if (command === "--version" || command === "-v") say(VERSION);
  else if (command === "" || command === "help" || command === "--help" || command === "-h") process.stdout.write(USAGE);
  else fail(`Remy has no ${command} command. Run remy --help.`);
} catch (error) {
  fail((error as Error).message || "That did not work; try again.");
}
