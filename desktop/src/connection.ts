import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import WebSocket from "ws";

/// The connection to a Remy server, owned by the main process.
///
/// It lives here rather than in the renderer for two reasons, both of which are
/// properties of the server rather than preferences:
///
///   1. The server sends no CORS headers, so a renderer on another origin
///      cannot call it at all.
///   2. `/notify/stream` authorises the upgrade with an `Authorization: Bearer`
///      header, and a browser `WebSocket` cannot set request headers.
///
/// Keeping it in Node solves both without touching the server, and has the
/// better security property anyway: the token never enters the renderer, so a
/// stray dependency in the UI has nothing to steal.

export type DeviceIcon = "laptop" | "monitor" | "smartphone" | "tablet" | "server" | "house";

export interface ServerConfig {
  id: string;
  name: string;
  url: string;
  token: string;
  icon?: DeviceIcon;
  /// This machine's own daemon. The app starts it; it cannot be unpaired.
  builtin?: boolean;
}

export interface ConnectionEvents {
  /// A frame from `/notify/stream`, tagged with which server it came from.
  push: (serverId: string, payload: unknown) => void;
  /// Connected / disconnected, so the UI can show a device as offline.
  status: (serverId: string, online: boolean, error?: string) => void;
}

export interface DesktopClient {
  version: string;
  arch: string;
  updates: boolean;
}

/// Reconnect backoff. The server is usually on the same tailnet, so the first
/// retry is quick; the ceiling stops a sleeping laptop from hammering it.
const BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000];

export class Connection extends EventEmitter {
  private sockets = new Map<string, WebSocket>();
  private attempts = new Map<string, number>();
  private timers = new Map<string, NodeJS.Timeout>();
  private closing = false;
  private topics = new Set<string>();
  private cursors = new Map<string, { streamId?: string; sequence?: number }>();

  constructor(private servers: ServerConfig[], private client?: DesktopClient) {
    super();
  }

  list(): Omit<ServerConfig, "token">[] {
    return this.servers.map(({ token: _token, ...rest }) => rest);
  }

  /// Name and icon only — a rename must not bounce the live socket.
  update(id: string, patch: { name?: string; icon?: DeviceIcon }): void {
    const server = this.servers.find((item) => item.id === id);
    if (!server) throw new Error(`no server ${id}`);
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name) server.name = name;
    }
    if (patch.icon) server.icon = patch.icon;
  }

  /// Full configs including tokens — main-process only, for persisting.
  configs(): ServerConfig[] {
    return this.servers.map((server) => ({ ...server }));
  }

  replace(servers: ServerConfig[]): void {
    this.stop();
    this.closing = false;
    this.servers = servers;
    this.cursors.clear();
    this.start();
  }

  setTopics(topics: string[]): void {
    this.topics = new Set(topics);
    const control = JSON.stringify({ type: "subscribe", topics: [...this.topics].sort() });
    for (const socket of this.sockets.values()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(control);
    }
  }

  send(serverId: string, payload: unknown): boolean {
    const socket = this.sockets.get(serverId);
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }

  /// One REST call against a named server. Returns the parsed body, or throws
  /// with the server's own message so the UI can show something specific.
  async request<T>(
    serverId: string,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const server = this.servers.find((s) => s.id === serverId);
    if (!server) throw new Error(`no server ${serverId}`);
    const response = await fetch(new URL(path, server.url), {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${server.token}`,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // A non-JSON body is still worth surfacing verbatim if it is short.
        if (text && text.length < 200) message = text;
      }
      throw new Error(message);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  /// Uploads bytes without exposing the device token to the renderer. The
  /// server owns the attachment afterwards, so a thread opened from another
  /// machine can use the same opaque reference.
  async upload<T>(
    serverId: string,
    path: string,
    input: { data: Uint8Array; filename: string; mimeType: string },
  ): Promise<T> {
    const server = this.servers.find((item) => item.id === serverId);
    if (!server) throw new Error(`no server ${serverId}`);
    const response = await fetch(new URL(path, server.url), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${server.token}`,
        "Content-Type": input.mimeType,
        "X-Filename": input.filename,
      },
      body: input.data,
    });
    const text = await response.text();
    if (!response.ok) {
      let message = text || `${response.status} ${response.statusText}`;
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // Keep a short non-JSON response as the useful detail.
      }
      throw new Error(message);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  start(): void {
    for (const server of this.servers) this.connect(server);
  }

  stop(): void {
    this.closing = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
  }

  private connect(server: ServerConfig): void {
    if (this.closing) return;
    const url = new URL("/notify/stream", server.url);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("scoped", "1");
    for (const topic of [...this.topics].sort()) url.searchParams.append("topic", topic);
    const cursor = this.cursors.get(server.id);
    if (cursor?.sequence !== undefined) {
      url.searchParams.set("afterSequence", String(cursor.sequence));
      if (cursor.streamId) url.searchParams.set("streamId", cursor.streamId);
    }
    if (server.builtin && this.client) {
      url.searchParams.set("client", "desktop");
      url.searchParams.set("version", this.client.version);
      url.searchParams.set("arch", this.client.arch);
      if (this.client.updates) url.searchParams.set("updates", "1");
      url.searchParams.set("browserHost", "1");
    }
    // `notify=0` subscribes to live state without becoming a notification
    // target. The desktop app wants the banners, so it is left absent.

    const socket = new WebSocket(url, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    this.sockets.set(server.id, socket);

    socket.on("open", () => {
      this.attempts.set(server.id, 0);
      socket.send(JSON.stringify({ type: "subscribe", topics: [...this.topics].sort() }));
      this.emit("status", server.id, true);
    });

    socket.on("message", (data) => {
      try {
        const payload = JSON.parse(String(data)) as Record<string, unknown>;
        const previous = this.cursors.get(server.id);
        if (payload.type === "hello") {
          const nextStream = typeof payload.streamId === "string" ? payload.streamId : undefined;
          const restarted = previous?.streamId !== undefined && previous.streamId !== nextStream;
          if (payload.reset === true || restarted || previous?.sequence === undefined) {
            this.cursors.set(server.id, {
              streamId: nextStream,
              sequence: typeof payload.sequence === "number" ? payload.sequence : undefined,
            });
          } else {
            this.cursors.set(server.id, { ...previous, streamId: nextStream });
          }
        } else if (typeof payload.sequence === "number"
          && (previous?.sequence === undefined || payload.sequence > previous.sequence)) {
          this.cursors.set(server.id, { ...previous, sequence: payload.sequence });
        }
        this.emit("push", server.id, payload);
      } catch {
        // A frame that isn't JSON is not worth tearing the socket down for.
      }
    });

    socket.on("error", (error: Error) => {
      this.emit("status", server.id, false, error.message);
    });

    socket.on("close", () => {
      this.sockets.delete(server.id);
      this.emit("status", server.id, false);
      this.scheduleReconnect(server);
    });
  }

  private scheduleReconnect(server: ServerConfig): void {
    if (this.closing) return;
    const attempt = this.attempts.get(server.id) ?? 0;
    this.attempts.set(server.id, attempt + 1);
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    const timer = setTimeout(() => this.connect(server), delay);
    // Don't hold the process open just to retry a dead server.
    timer.unref?.();
    this.timers.set(server.id, timer);
  }
}

/// Servers live in sqlite next to the app's other state, or come from
/// `MC_SERVER_URL` / `MC_TOKEN` for a one-off run.
export function loadServers(dbPath: string): ServerConfig[] {
  const fromEnv = process.env.MC_SERVER_URL;
  if (fromEnv) {
    return [
      {
        id: "env",
        name: process.env.MC_SERVER_NAME ?? new URL(fromEnv).hostname,
        url: fromEnv,
        token: process.env.MC_TOKEN ?? "",
      },
    ];
  }
  const database = openServers(dbPath);
  try {
    return (
      database.prepare("select id, name, url, token, icon, builtin from paired_servers").all() as {
        id: string;
        name: string;
        url: string;
        token: string;
        icon: string | null;
        builtin: number;
      }[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      token: row.token,
      ...(row.icon ? { icon: row.icon as DeviceIcon } : {}),
      ...(row.builtin ? { builtin: true } : {}),
    }));
  } finally {
    database.close();
  }
}

export function saveServers(dbPath: string, servers: ServerConfig[]): void {
  const database = openServers(dbPath);
  try {
    database.exec("begin immediate");
    try {
      database.exec("delete from paired_servers");
      const insert = database.prepare(
        "insert into paired_servers (id, name, url, token, icon, builtin) values (?, ?, ?, ?, ?, ?)",
      );
      for (const server of servers) {
        insert.run(server.id, server.name, server.url, server.token, server.icon ?? null, server.builtin ? 1 : 0);
      }
      database.exec("commit");
    } catch (error) {
      try {
        database.exec("rollback");
      } catch {
        // The original error is the one to throw.
      }
      throw error;
    }
  } finally {
    database.close();
  }
}

function openServers(dbPath: string): DatabaseSync {
  mkdirSync(join(dbPath, ".."), { recursive: true });
  const database = new DatabaseSync(dbPath);
  database.exec(`
    create table if not exists paired_servers (
      id text primary key,
      name text not null,
      url text not null,
      token text not null,
      icon text,
      builtin integer not null default 0
    );
  `);
  return database;
}

export const serversFile = (userData: string) => join(userData, "remy.db");
