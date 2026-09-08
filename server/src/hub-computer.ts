import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { hostname } from "node:os";
import {
  COMPUTER_HEARTBEAT_INTERVAL_MS,
  COMPUTER_PROTOCOL_VERSION,
  computerConnectionMessage,
  computerRegistrationSchema,
  hubToComputerFrameSchema,
  type ComputerCapabilities,
  type ComputerConnectionAuthorization,
  type ComputerRegistration,
  type HubToComputerFrame,
} from "@remy/contract";
import WebSocket from "ws";
import { deviceId } from "./board-log.js";
import { config } from "./config.js";
import { getKv, setKv } from "./db.js";
import { discoveredProviders } from "./provider-adapters/index.js";
import { tooling } from "./tooling.js";
import { listWorkspaces } from "./workspaces.js";

const REGISTRATION_KEY = "hubComputerRegistration";
const PRIVATE_KEY_KV = "hubComputerPrivateKey";
const KEYCHAIN_SERVICE = "me.padamchopra.Remy.hub-computer";
const DAEMON_VERSION = process.env.REMY_SERVER_RELEASE || "0.1.0";

export type HubComputerRegistration = ComputerRegistration & { hubUrl: string };

function base64url(value: Uint8Array | Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function privateKey(): { privateKey: string; publicKey: string } {
  let stored: string | undefined;
  if (process.platform === "darwin" && !process.env.MC_CONFIG_DIR) {
    try { stored = execFileSync("/usr/bin/security", ["find-generic-password", "-a", deviceId, "-s", KEYCHAIN_SERVICE, "-w"], { encoding: "utf8" }).trim(); } catch { stored = undefined; }
  } else stored = getKv<string>(PRIVATE_KEY_KV);
  if (stored) {
    const key = createPrivateKey({ key: Buffer.from(stored, "base64url"), format: "der", type: "pkcs8" });
    const publicKey = Buffer.from(createPublicKey(key).export({ format: "der", type: "spki" })).toString("base64url");
    return { privateKey: stored, publicKey };
  }
  const pair = generateKeyPairSync("ed25519");
  const encoded = pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url");
  if (process.platform === "darwin" && !process.env.MC_CONFIG_DIR) execFileSync("/usr/bin/security", ["add-generic-password", "-U", "-a", deviceId, "-s", KEYCHAIN_SERVICE, "-w", encoded], { stdio: "ignore" });
  else setKv(PRIVATE_KEY_KV, encoded);
  return { privateKey: encoded, publicKey: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url") };
}

export async function computerCapabilities(): Promise<ComputerCapabilities> {
  const [providers, status, workspaces] = await Promise.all([discoveredProviders(), tooling({ providerUpdates: false }), listWorkspaces()]);
  return {
    providers: providers.filter((provider) => status[provider.id].available).map((provider) => ({ id: provider.id, models: provider.models.map((model) => model.value) })),
    workspaces: workspaces.map(({ id, name, path, origin }) => ({ id, name, path, origin })),
    worktrees: status.git.available,
    terminals: true,
    emulator: process.platform === "darwin" && commandExists("/usr/bin/xcrun", ["-f", "simctl"]),
  };
}

function commandExists(file: string, args: string[]): boolean {
  try { execFileSync(file, args, { stdio: "ignore", timeout: 2_000 }); return true; } catch { return false; }
}

export function connectionAuthorization(organizationId: string, computerId: string, encodedPrivateKey: string, now = Date.now()): string {
  const unsigned = { computerId, timestamp: now, nonce: base64url(randomBytes(18)) };
  const key = createPrivateKey({ key: Buffer.from(encodedPrivateKey, "base64url"), format: "der", type: "pkcs8" });
  const authorization: ComputerConnectionAuthorization = { ...unsigned, signature: base64url(sign(null, Buffer.from(computerConnectionMessage(organizationId, unsigned)), key)) };
  return `RemyComputer ${base64url(JSON.stringify(authorization))}`;
}

export async function registerHubComputer(hubUrl: string, organizationId: string, accessToken: string): Promise<HubComputerRegistration> {
  const keys = privateKey();
  const input = {
    computerId: deviceId,
    name: config.deviceName || hostname(),
    platform: process.platform === "linux" ? "linux" as const : "darwin" as const,
    daemonVersion: DAEMON_VERSION,
    protocol: { minimum: COMPUTER_PROTOCOL_VERSION, maximum: COMPUTER_PROTOCOL_VERSION },
    publicKey: keys.publicKey,
    capabilities: await computerCapabilities(),
  };
  const response = await fetch(new URL(`/api/organizations/${encodeURIComponent(organizationId)}/computers`, hubUrl), {
    method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`The hub refused this computer (${response.status}).`);
  const registration = { ...computerRegistrationSchema.parse(await response.json()), hubUrl: new URL(hubUrl).origin };
  setKv(REGISTRATION_KEY, registration);
  restartHubComputerConnection(registration);
  return registration;
}

export async function registerHubComputerWithDeviceCode(hubUrl: string, organizationId: string, deviceCode: string): Promise<HubComputerRegistration> {
  const tokenResponse = await fetch(new URL("/api/device/token", hubUrl), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceCode }), signal: AbortSignal.timeout(15_000),
  });
  if (tokenResponse.status === 202) throw new Error("Approve this computer, then try again.");
  if (tokenResponse.status === 429) throw new Error("Wait a moment, then try again.");
  if (!tokenResponse.ok) throw new Error("Start computer authorization again.");
  const token = await tokenResponse.json() as { accessToken?: unknown };
  if (typeof token.accessToken !== "string") throw new Error("Start computer authorization again.");
  return registerHubComputer(hubUrl, organizationId, token.accessToken);
}

export class HubComputerConnection {
  private socket?: WebSocket;
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private attempts = 0;
  private readonly subscriptions = new Map<string, WebSocket>();

  constructor(private readonly registration: HubComputerRegistration, private readonly makeCapabilities = computerCapabilities) {}

  start(): void { this.stopped = false; this.connect(); }
  stop(): void { this.stopped = true; clearTimeout(this.retry); clearInterval(this.heartbeat); this.socket?.close(); for (const stream of this.subscriptions.values()) stream.close(); this.subscriptions.clear(); }

  private connect(): void {
    if (this.stopped) return;
    const key = privateKey();
    const url = new URL(`/api/organizations/${encodeURIComponent(this.registration.organizationId)}/computers/connect`, this.registration.hubUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, { headers: { authorization: connectionAuthorization(this.registration.organizationId, this.registration.computerId, key.privateKey) } });
    this.socket = socket;
    socket.on("open", () => { this.attempts = 0; void this.hello(socket); this.heartbeat = setInterval(() => socket.send(JSON.stringify({ kind: "heartbeat", availability: "available", observedAt: Date.now() })), COMPUTER_HEARTBEAT_INTERVAL_MS); });
    socket.on("message", (data) => { void this.message(socket, data.toString()); });
    socket.on("close", () => { clearInterval(this.heartbeat); if (!this.stopped) this.scheduleReconnect(); });
    socket.on("error", () => undefined);
  }

  private async hello(socket: WebSocket): Promise<void> {
    socket.send(JSON.stringify({ kind: "hello", protocolVersion: COMPUTER_PROTOCOL_VERSION, daemonVersion: DAEMON_VERSION, capabilities: await this.makeCapabilities() }));
  }

  private scheduleReconnect(): void {
    const maximum = Math.min(30_000, 500 * 2 ** Math.min(this.attempts++, 6));
    this.retry = setTimeout(() => this.connect(), Math.floor(maximum * (0.75 + Math.random() * 0.5)));
  }

  private async message(socket: WebSocket, raw: string): Promise<void> {
    const parsed = hubToComputerFrameSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) { socket.close(1003, "Invalid hub frame."); return; }
    if (parsed.data.kind === "update_required") { this.stopped = true; socket.close(1008, "Update Remy to reconnect."); return; }
    if (parsed.data.kind === "request") await this.proxy(socket, parsed.data);
    if (parsed.data.kind === "subscribe") this.subscribe(socket, parsed.data.id, parsed.data.path);
    if (parsed.data.kind === "unsubscribe") { this.subscriptions.get(parsed.data.id)?.close(); this.subscriptions.delete(parsed.data.id); }
  }

  private subscribe(socket: WebSocket, id: string, path: string): void {
    const local = new WebSocket(`ws://127.0.0.1:${config.port}${path}`, { headers: { authorization: `Bearer ${config.token}` } });
    this.subscriptions.set(id, local);
    local.on("message", (payload) => socket.send(JSON.stringify({ kind: "stream", id, payload: payload.toString() })));
    local.on("close", () => { this.subscriptions.delete(id); if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: "stream.end", id })); });
    local.on("error", () => undefined);
  }

  private async proxy(socket: WebSocket, frame: Extract<HubToComputerFrame, { kind: "request" }>): Promise<void> {
    try {
      const headers = new Headers(frame.headers); headers.set("authorization", `Bearer ${config.token}`); headers.delete("host"); headers.delete("cookie");
      const response = await fetch(`http://127.0.0.1:${config.port}${frame.path}`, { method: frame.method, headers, body: frame.body ? Buffer.from(frame.body, "base64url") : undefined, redirect: "manual" });
      const responseHeaders: Record<string, string> = {}; response.headers.forEach((value, key) => { if (!key.startsWith("set-cookie")) responseHeaders[key] = value; });
      socket.send(JSON.stringify({ kind: "response", id: frame.id, status: response.status, headers: responseHeaders, body: base64url(Buffer.from(await response.arrayBuffer())) }));
    } catch {
      socket.send(JSON.stringify({ kind: "response", id: frame.id, status: 502, headers: { "content-type": "application/json" }, body: base64url('{"error":"The computer could not complete this request."}') }));
    }
  }
}

let connection: HubComputerConnection | undefined;
function restartHubComputerConnection(registration: HubComputerRegistration): void {
  connection?.stop();
  connection = new HubComputerConnection(registration);
  connection.start();
}

export function startHubComputerConnection(): void {
  const registration = getKv<HubComputerRegistration>(REGISTRATION_KEY);
  if (!registration || !config.hubMode) return;
  restartHubComputerConnection(registration);
}

export function hubComputerRegistration(): Omit<HubComputerRegistration, "publicKey"> | undefined {
  const registration = getKv<HubComputerRegistration>(REGISTRATION_KEY);
  if (!registration) return undefined;
  const { publicKey: _, ...safe } = registration;
  return safe;
}
