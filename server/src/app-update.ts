import { AutomaticUpdate } from "./automatic-update.js";
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
  automatic: boolean;
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
  const next = { socket, version, automatic: params.get("automaticUpdates") === "1", ...(arch ? { arch } : {}) };
  host = undefined;
  syncAutomaticUpdates();
  host = next;
  if (attempt?.state === "installing" && attempt.fromVersion !== version) attempt = undefined;
  socket.on("close", () => {
    if (host?.socket !== socket) return;
    host = undefined;
    syncAutomaticUpdates();
    if (attempt?.state === "starting" || attempt?.state === "downloading") {
      attempt = { ...attempt, state: "failed", error: "Remy closed before the update was installed." };
    }
  });
  socket.on("error", () => {
    if (host?.socket !== socket) return;
    host = undefined;
    syncAutomaticUpdates();
    if (attempt?.state === "starting" || attempt?.state === "downloading") {
      attempt = { ...attempt, state: "failed", error: "Remy disconnected before the update was installed." };
    }
  });
  syncAutomaticUpdates();
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
  if (automatic.status.phase !== "idle" && automatic.status.phase !== "failed") throw new Error("An automatic update is already pending.");
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

let automaticRequestId: string | undefined;
let automaticOptions: { enabled: () => boolean; busy: () => number; changed: () => void } | undefined;
let installingAt = 0;
const automatic = new AutomaticUpdate({
  now: Date.now,
  changed: () => automaticOptions?.changed(),
  download: () => {
    automaticRequestId = randomUUID();
    host?.socket.send(JSON.stringify({ type: "app-update", action: "download-automatic", requestId: automaticRequestId }));
  },
  install: () => {
    installingAt = Date.now();
    host?.socket.send(JSON.stringify({ type: "app-update", action: "install-automatic", requestId: automaticRequestId }));
  },
});

export function configureAutomaticUpdates(options: NonNullable<typeof automaticOptions>): void {
  automaticOptions = options;
}

export function syncAutomaticUpdates(): void {
  if (!automaticOptions) return;
  if (automatic.status.phase === "installing" && Date.now() - installingAt > 60_000) {
    automatic.fail("Remy could not relaunch; try updating again.");
  }
  automatic.tick(automaticOptions.enabled(), Boolean(host?.automatic && host.socket.readyState === host.socket.OPEN), automaticOptions.busy() > 0 || Boolean(attempt && attempt.state !== "failed"));
}

export function automaticUpdateStatus() {
  return { enabled: automaticOptions?.enabled() ?? false, supported: Boolean(host?.automatic), ...automatic.status };
}

export function automaticUpdateAction(action: unknown, deadline: unknown): void {
  syncAutomaticUpdates();
  if (typeof deadline !== "number") throw new Error("That update countdown has ended.");
  if (action === "snooze") automatic.snooze(deadline);
  else if (action === "relaunch") automatic.relaunch(deadline);
  else throw new Error("Choose when Remy should relaunch.");
}

export function reportAutomaticUpdate(input: Record<string, unknown>): boolean {
  if (input.requestId !== automaticRequestId || !automaticRequestId) return false;
  syncAutomaticUpdates();
  if (input.state === "ready" || input.state === "current") automatic.downloaded(input.state === "ready");
  else if (input.state === "failed") automatic.fail(typeof input.error === "string" ? input.error.slice(0, 240) : "Remy could not update; try again.");
  else if (input.state === "installing") {
    if (automatic.status.phase !== "installing" || !automaticOptions?.enabled() || automaticOptions.busy() > 0) {
      automatic.fail("Remy will update when your threads settle.");
      throw new Error("Remy will update when your threads settle.");
    }
  } else throw new Error("That update state is not valid.");
  return true;
}

export function assertAppNotRestarting(): void {
  if (automatic.status.phase === "installing" && Date.now() - installingAt < 60_000) {
    throw new Error("Remy is relaunching to update; try again in a moment.");
  }
}

export let pendingChatStarts = 0;
export async function withAppUpdateGuard<T>(run: () => Promise<T>): Promise<T> {
  assertAppNotRestarting();
  pendingChatStarts++;
  try { return await run(); } finally { pendingChatStarts--; }
}
