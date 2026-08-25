import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

export type AppUpdatePhase = "idle" | "starting" | "downloading" | "installing" | "failed";

export interface AppUpdateStatus {
  supported: boolean;
  version?: string;
  arch?: string;
  state: AppUpdatePhase;
  busyThreads: number;
  error?: string;
}

interface UpdateHost {
  socket: WebSocket;
  version: string;
  arch?: string;
}

interface UpdateAttempt {
  id: string;
  fromVersion: string;
  state: Exclude<AppUpdatePhase, "idle">;
  error?: string;
}

let host: UpdateHost | undefined;
let attempt: UpdateAttempt | undefined;

function clean(value: string | null, limit: number): string | undefined {
  const text = value?.trim().slice(0, limit);
  return text || undefined;
}

/// Registers the packaged desktop shell behind this daemon as the process that
/// can replace Remy.app. A daemon may outlive its window, so support exists only
/// while that shell's authenticated live connection is actually present.
export function attachAppUpdateHost(socket: WebSocket, params: URLSearchParams): void {
  if (params.get("client") !== "desktop" || params.get("updates") !== "1") return;
  const version = clean(params.get("version"), 40);
  if (!version) return;
  const arch = clean(params.get("arch"), 20);
  const next = { socket, version, ...(arch ? { arch } : {}) };
  host = next;
  if (attempt?.state === "installing" && attempt.fromVersion !== version) attempt = undefined;
  socket.on("close", () => {
    if (host?.socket !== socket) return;
    host = undefined;
    if (attempt?.state === "starting" || attempt?.state === "downloading") {
      attempt = { ...attempt, state: "failed", error: "Remy closed before the update was installed." };
    }
  });
  socket.on("error", () => {
    if (host?.socket !== socket) return;
    host = undefined;
    if (attempt?.state === "starting" || attempt?.state === "downloading") {
      attempt = { ...attempt, state: "failed", error: "Remy disconnected before the update was installed." };
    }
  });
}

export function appUpdateStatus(busyThreads: number): AppUpdateStatus {
  return {
    supported: Boolean(host),
    ...(host ? { version: host.version, ...(host.arch ? { arch: host.arch } : {}) } : {}),
    state: attempt?.state ?? "idle",
    busyThreads,
    ...(attempt?.error ? { error: attempt.error } : {}),
  };
}

/// Asks the desktop shell on this machine to use its native signed updater.
/// The caller may be a paired machine, but it never receives a download URL or
/// a shell command; the target app chooses and installs its own architecture.
export function requestAppUpdate(busyThreads: number): AppUpdateStatus {
  if (!host || host.socket.readyState !== host.socket.OPEN) {
    throw new Error("Open Remy on this device to update it.");
  }
  if (busyThreads > 0) {
    throw new Error("Stop the running threads on this device before updating Remy.");
  }
  if (attempt && attempt.state !== "failed") return appUpdateStatus(busyThreads);

  attempt = { id: randomUUID(), fromVersion: host.version, state: "starting" };
  host.socket.send(JSON.stringify({
    type: "app-update",
    action: "install-latest",
    requestId: attempt.id,
  }));
  return appUpdateStatus(busyThreads);
}

export function reportAppUpdate(input: Record<string, unknown>, busyThreads: number): AppUpdateStatus {
  if (!attempt || input.requestId !== attempt.id) throw new Error("That update request is no longer active.");
  if (input.state !== "downloading" && input.state !== "installing" && input.state !== "failed") {
    throw new Error("That update state is not valid.");
  }
  attempt = {
    id: attempt.id,
    fromVersion: attempt.fromVersion,
    state: input.state,
    ...(input.state === "failed" && typeof input.error === "string"
      ? { error: input.error.trim().slice(0, 240) || "Couldn't install the update." }
      : {}),
  };
  return appUpdateStatus(busyThreads);
}
