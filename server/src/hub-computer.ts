import { HubBoardSync } from "./hub-board.js";
import { handleHubThreadRequest, hubThreadIds, hubThreadSnapshot } from "./hub-threads.js";
import { onLocalBroadcast, onAddressedNotification } from "./notify.js";
import { saveChatImage } from "./chat-attachments.js";
import { execFileSync } from "node:child_process";
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { hostname } from "node:os";
import {
  COMPUTER_HEARTBEAT_INTERVAL_MS,
  COMPUTER_PROTOCOL_VERSION,
  computerConnectionMessage,
  computerRegistrationSchema,
  hubToComputerFrameSchema,
  type HubNotificationInput,
  type ComputerCapabilities,
  type ComputerConnectionAuthorization,
  type ComputerRegistration,
  type HubToComputerFrame,
} from "@remy/contract";
import WebSocket from "ws";
import { deviceId } from "./board-log.js";
import { config, patchSettings } from "./config.js";
import { getKv, setKv } from "./db.js";
import { discoveredProviders } from "./provider-adapters/index.js";
import { tooling } from "./tooling.js";
import { listWorkspaces } from "./workspaces.js";

const NOTIFICATION_OUTBOX = "hubNotificationOutbox";
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

export async function hubRegistrationScope(hubUrl: string, organizationId: string, accessToken: string, ownership: string): Promise<string> {
  if (organizationId) return organizationId;
  if (ownership !== "personal") throw new Error("Choose an organization for a shared computer.");
  const response = await fetch(new URL("/api/personal", hubUrl), {
    headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000), redirect: "error",
  });
  if (!response.ok) throw new Error("Your personal account could not be opened; try again.");
  const result = await response.json() as { personal?: { id?: unknown; personal?: unknown } };
  if (typeof result.personal?.id !== "string" || !result.personal.id || result.personal.personal !== true) throw new Error("Your personal account could not be opened; try again.");
  return result.personal.id;
}

export async function registerHubComputer(hubUrl: string, organizationId: string, accessToken: string, ownership: "personal" | "organization" | "hosted" = "personal"): Promise<HubComputerRegistration> {
  organizationId = await hubRegistrationScope(hubUrl, organizationId, accessToken, ownership);
  const keys = privateKey();
  const input = {
    computerId: deviceId,
    name: config.deviceName || hostname(),
    icon: config.deviceIcon, ownership,
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
  patchSettings({ hubMode: true });
  restartHubComputerConnection(registration);
  return registration;
}

export async function registerHubComputerWithDeviceCode(hubUrl: string, organizationId: string, deviceCode: string, ownership: "personal" | "organization" | "hosted" = "personal"): Promise<HubComputerRegistration> {
  const tokenResponse = await fetch(new URL("/api/device/token", hubUrl), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceCode }), signal: AbortSignal.timeout(15_000),
  });
  if (tokenResponse.status === 202) throw new Error("Approve this computer, then try again.");
  if (tokenResponse.status === 429) throw new Error("Wait a moment, then try again.");
  if (!tokenResponse.ok) throw new Error("Start computer authorization again.");
  const token = await tokenResponse.json() as { accessToken?: unknown };
  if (typeof token.accessToken !== "string") throw new Error("Start computer authorization again.");
  return registerHubComputer(hubUrl, organizationId, token.accessToken, ownership);
}

export class HubComputerConnection {
  private socket?: WebSocket;
  private boardSync?: HubBoardSync;
  private stopped = false;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private attempts = 0;
  private threadRelay = false;
  private introduced = false;
  private syncingThreads = false;
  private notificationRelay = false;
  private offNotifications?: () => void;
  private offBroadcast?: () => void;
  private snapshots = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly subscriptions = new Map<string, WebSocket>();

  constructor(private readonly registration: HubComputerRegistration, private readonly makeCapabilities = computerCapabilities) {}

  start(): void { if (!this.stopped && this.socket && this.socket.readyState <= WebSocket.OPEN) return; this.stopped = false;
    this.offNotifications?.();
    this.offNotifications = onAddressedNotification((evt) => {
      if (!hubThreadSnapshot(evt.session, this.registration.organizationId)) return false;
      const outbox = (getKv<HubNotificationInput[]>(NOTIFICATION_OUTBOX) ?? []).filter((n) => n.createdAt > Date.now() - 7 * 86400000);
      outbox.push({ id: randomUUID(), threadId: evt.session, title: evt.title.slice(0, 160), message: evt.message.slice(0, 500), highPriority: evt.highPriority, createdAt: Date.now() });
      setKv(NOTIFICATION_OUTBOX, outbox.slice(-1000));
      this.flushNotifications();
      return true;
    });
    this.boardSync?.stop();
    this.boardSync = new HubBoardSync(this.registration.organizationId, async (input) => {
      const url = new URL(`/api/organizations/${encodeURIComponent(this.registration.organizationId)}/computers/board-sync`, this.registration.hubUrl);
      const response = await fetch(url, { method: "POST", headers: { authorization: connectionAuthorization(this.registration.organizationId, this.registration.computerId, privateKey().privateKey), "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) throw new Error("Tasks could not synchronize.");
      return response.json() as Promise<{ version: Record<string, number>; events: import("@remy/contract").BoardLogEvent[] }>;
    });
    this.boardSync.start();
    this.connect(); }
  stop(): void { this.boardSync?.stop(); this.offNotifications?.(); this.offBroadcast?.(); for (const timer of this.snapshots.values()) clearTimeout(timer); this.snapshots.clear(); this.stopped = true; clearTimeout(this.retry); clearInterval(this.heartbeat); const socket = this.socket; this.socket = undefined; socket?.close(); for (const stream of this.subscriptions.values()) stream.close(); this.subscriptions.clear(); }

  syncBoard(): void { void this.boardSync?.sync(); }

  private connect(): void {
    if (this.stopped) return;
    this.threadRelay = false; this.notificationRelay = false; this.introduced = false; this.syncingThreads = false;
    const key = privateKey();
    const url = new URL(`/api/organizations/${encodeURIComponent(this.registration.organizationId)}/computers/connect`, this.registration.hubUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url, { headers: { authorization: connectionAuthorization(this.registration.organizationId, this.registration.computerId, key.privateKey) } });
    this.socket = socket;
    socket.on("open", () => {
      if (this.socket !== socket || this.stopped) { socket.close(); return; }
      this.attempts = 0;
      void this.hello(socket).catch(() => socket.close(1011, "Reconnect to update this computer."));
      this.heartbeat = setInterval(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: "heartbeat", availability: "available", observedAt: Date.now() })); this.flushNotifications(); this.boardSync?.retry(); }, COMPUTER_HEARTBEAT_INTERVAL_MS);
    });
    socket.on("message", (data) => { if (this.socket === socket) void this.message(socket, data.toString()).catch(() => socket.close(1011, "Reconnect to continue.")); });
    socket.on("close", (code, reason) => { if (this.socket !== socket) return; if (code === 1008 && reason.toString() === "This computer was removed.") { this.stopped = true; this.offNotifications?.(); } this.socket = undefined; this.offBroadcast?.(); for (const stream of this.subscriptions.values()) stream.close(); this.subscriptions.clear(); clearInterval(this.heartbeat); if (!this.stopped) this.scheduleReconnect(); });
    socket.on("error", () => undefined);
  }

  private async hello(socket: WebSocket): Promise<void> {
    const capabilities = await this.makeCapabilities();
    if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ kind: "hello", boardSync: true, protocolVersion: COMPUTER_PROTOCOL_VERSION, daemonVersion: DAEMON_VERSION, capabilities }));
    this.introduced = true;
    void this.boardSync?.sync();
    this.syncThreads(socket);
    this.flushNotifications();
  }

  private syncThreads(socket: WebSocket): void {
    if (!this.introduced || !this.threadRelay || this.syncingThreads) return;
    this.syncingThreads = true;
    const publish = (id: string) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const snapshot = hubThreadSnapshot(id, this.registration.organizationId);
      if (snapshot) socket.send(JSON.stringify({ kind: "thread.snapshot", snapshot }));
      else socket.send(JSON.stringify({ kind: "thread.manifest", ids: hubThreadIds(this.registration.organizationId) }));
    };
    this.offBroadcast?.();
    this.offBroadcast = onLocalBroadcast((value) => {
      const frame = value as { type?: string; chatId?: string };
      if (frame.type === "chats") {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: "thread.manifest", ids: hubThreadIds(this.registration.organizationId) }));
      }
      if (!frame.chatId || !["chat", "hub-thread"].includes(frame.type ?? "") || this.snapshots.has(frame.chatId)) return;
      const id = frame.chatId;
      this.snapshots.set(id, setTimeout(() => { this.snapshots.delete(id); publish(id); }, 50));
    });
    for (const id of hubThreadIds(this.registration.organizationId)) publish(id);
    socket.send(JSON.stringify({ kind: "thread.manifest", ids: hubThreadIds(this.registration.organizationId) }));
  }

  private flushNotifications(): void {
    const socket = this.socket;
    if (!this.introduced || !this.notificationRelay || socket?.readyState !== WebSocket.OPEN) return;
    for (const notification of getKv<HubNotificationInput[]>(NOTIFICATION_OUTBOX) ?? []) {
      const snapshot = hubThreadSnapshot(notification.threadId, this.registration.organizationId);
      if (!snapshot) continue;
      socket.send(JSON.stringify({ kind: "thread.snapshot", snapshot }));
      socket.send(JSON.stringify({ kind: "notification", notification }));
    }
  }

  private scheduleReconnect(): void {
    const maximum = Math.min(30_000, 500 * 2 ** Math.min(this.attempts++, 6));
    this.retry = setTimeout(() => this.connect(), Math.floor(maximum * (0.75 + Math.random() * 0.5)));
  }

  private async message(socket: WebSocket, raw: string): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { socket.close(1003, "Invalid hub frame."); return; }
    const parsed = hubToComputerFrameSchema.safeParse(value);
    if (!parsed.success) { socket.close(1003, "Invalid hub frame."); return; }
    if (parsed.data.kind === "welcome") { this.threadRelay = parsed.data.threadRelay === true; this.notificationRelay = parsed.data.notifications === true; this.syncThreads(socket); this.flushNotifications(); }
    if (parsed.data.kind === "board.changed") void this.boardSync?.sync();
    if (parsed.data.kind === "notification.ack") { const id = parsed.data.id; setKv(NOTIFICATION_OUTBOX, (getKv<HubNotificationInput[]>(NOTIFICATION_OUTBOX) ?? []).filter((n) => n.id !== id)); }
    if (parsed.data.kind === "update_required") { this.stopped = true; socket.close(1008, "Update Remy to reconnect."); return; }
    if (parsed.data.kind === "agent.deleted") { const {deleteChat}=await import("./chat.js");const shared=new Set(hubThreadIds(this.registration.organizationId));for(const id of parsed.data.threadIds)if(shared.has(id))deleteChat(id); }
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
      if (frame.path.startsWith("/hub/threads")) {
        if (!frame.actor || frame.body.length > 128_000) throw new Error("Invalid thread request");
        const input = frame.body ? JSON.parse(Buffer.from(frame.body, "base64url").toString()) : {};
        const response = await handleHubThreadRequest(this.registration.organizationId, frame.actor, frame.method, frame.path, input, async (chatId, attachmentId) => {
          const url = new URL(`/api/organizations/${encodeURIComponent(this.registration.organizationId)}/computers/${encodeURIComponent(this.registration.computerId)}/thread-attachments/${chatId}/${attachmentId}`, this.registration.hubUrl);
          const image = await fetch(url, { headers: { authorization: connectionAuthorization(this.registration.organizationId, this.registration.computerId, privateKey().privateKey) }, signal: AbortSignal.timeout(15_000), redirect: "error" });
          if (!image.ok || Number(image.headers.get("content-length")) > 10 * 1024 * 1024) throw new Error("This image is no longer available.");
          return { ...saveChatImage(chatId, image.headers.get("x-filename"), image.headers.get("content-type"), Buffer.from(await image.arrayBuffer())), remoteId: attachmentId };
        });
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: "response", id: frame.id, status: response.status, headers: { "content-type": "application/json" }, body: base64url(await response.text()) }));
        return;
      }
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

export function stopHubComputerConnection(): void {
  connection?.stop();
  connection = undefined;
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

export async function detachHubComputer(): Promise<void> {
  const registration = getKv<HubComputerRegistration>(REGISTRATION_KEY);
  if (registration) {
    const url = new URL(`/api/organizations/${encodeURIComponent(registration.organizationId)}/computers/detach`, registration.hubUrl);
    const response = await fetch(url, { method: "POST", headers: { authorization: connectionAuthorization(registration.organizationId, registration.computerId, privateKey().privateKey) }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok && response.status !== 401) throw new Error("This computer could not be removed; try again when your organization reconnects.");
  }
  stopHubComputerConnection();
  setKv(REGISTRATION_KEY, null);
  setKv(NOTIFICATION_OUTBOX, []);
  patchSettings({ hubMode: false });
}

export async function beginHubComputerAuthorization(hubUrl: string, organizationId: string, ownership: "personal" | "organization" | "hosted") {
  const url = new URL(hubUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("Enter a secure Remy address.");
  if ((!organizationId && ownership !== "personal") || organizationId.length > 200) throw new Error("Choose your organization.");
  const response = await fetch(new URL("/api/device/authorization", url.origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientKind: "computer", clientName: config.deviceName || hostname() }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Remy could not be reached; try again.");
  const value = await response.json() as { deviceCode: string; userCode: string; expiresIn: number };
  if (typeof value.deviceCode !== "string" || typeof value.userCode !== "string") throw new Error("Start computer authorization again.");
  setKv("hubPendingAuthorization", { hubUrl: url.origin, organizationId, ownership, deviceCode: value.deviceCode, expiresAt: Date.now() + value.expiresIn * 1000 });
  return { userCode: value.userCode };
}

export async function finishHubComputerAuthorization() {
  const pending = getKv<{ hubUrl: string; organizationId: string; ownership: "personal" | "organization" | "hosted"; deviceCode: string; expiresAt: number }>("hubPendingAuthorization");
  if (!pending || pending.expiresAt <= Date.now()) throw new Error("Start computer authorization again.");
  await registerHubComputerWithDeviceCode(pending.hubUrl, pending.organizationId, pending.deviceCode, pending.ownership);
  setKv("hubPendingAuthorization", null);
  return hubComputerRegistration();
}

export function syncHubBoard(): void { connection?.syncBoard(); }
