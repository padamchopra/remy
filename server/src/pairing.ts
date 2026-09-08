import { randomInt, randomUUID } from "node:crypto";
import { config } from "./config.js";
import { deviceId } from "./board-log.js";
import { peerAddress, thisMachineIcon, thisMachineName, thisMachineTint } from "./peers.js";

/// Pairing two machines without carrying a token between them.
///
/// Verified same-owner Tailscale Serve requests need only the initiating action.
/// Other requests require matching the code on the receiving machine.
/// Claims remain opaque, rate-limited, expiring, and single-use on both paths.

export type PairState = "pending" | "approved" | "denied" | "expired";

export interface PairRequest {
  id: string;
  /// Compared on both machines when Tailscale ownership cannot be verified.
  code: string;
  fromDeviceId: string;
  fromName: string;
  fromIcon?: string;
  fromTint?: string;
  fromUrl: string;
  at: number;
  state: PairState;
  /// This machine's own address, fixed at the moment of approval — it is what
  /// the asking machine will call back on.
  approvedUrl?: string;
}

/// What a client on this machine sees while deciding.
export type PairRequestView = Omit<PairRequest, "state"> & { state: PairState };

/// Long enough to walk to the other machine, short enough that a request you
/// have forgotten about is not still standing later.
const TTL_MS = 3 * 60_000;
/// A cap so an unauthenticated route cannot be used to fill memory or to bury a
/// real request under a hundred fake prompts.
const MAX_PENDING = 5;
const MAX_PER_MINUTE = 10;

const requests = new Map<string, PairRequest>();
const recent: number[] = [];

function sweep(): void {
  const now = Date.now();
  for (const [id, request] of requests) {
    if (now - request.at > TTL_MS) requests.set(id, { ...request, state: "expired" });
    // Keep an expired request briefly so the asking machine is told "expired"
    // rather than left guessing, then forget it.
    if (now - request.at > TTL_MS * 2) requests.delete(id);
  }
  while (recent.length > 0 && now - recent[0] > 60_000) recent.shift();
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/// Six digits, from a real random source. Formatted `418 902` for reading aloud
/// and comparing at a glance; the digits are what is stored.
function mintCode(): string {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += String(randomInt(0, 10));
  return code;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/// A machine asking to pair. Answers only an id — deliberately nothing else.
export function askToPair(body: Record<string, unknown>): { requestId: string } {
  sweep();

  if (recent.length >= MAX_PER_MINUTE) throw new Error("too many pairing requests just now");
  const pending = [...requests.values()].filter((request) => request.state === "pending");
  if (pending.length >= MAX_PENDING) throw new Error("too many pairing requests waiting");

  const fromDeviceId = text(body.deviceId, 64);
  const fromName = text(body.name, 80);
  const fromIcon = text(body.icon, 32);
  const fromTint = text(body.tint, 32);
  const code = text(body.code, 6);
  if (!fromDeviceId) throw new Error("that request does not say which machine it is from");
  if (fromDeviceId === deviceId) throw new Error("that request is from this machine");
  if (!/^\d{6}$/.test(code)) throw new Error("that request has no code");
  // Where we would have to call it back. Held to the same shape as any peer
  // address, so an approval cannot store something unreachable.
  const fromUrl = peerAddress(body.url);

  // One machine asking twice replaces its own request rather than stacking up.
  for (const [id, request] of requests) {
    if (request.fromDeviceId === fromDeviceId && request.state === "pending") requests.delete(id);
  }

  const request: PairRequest = {
    id: randomUUID(),
    code,
    fromDeviceId,
    fromName: fromName || new URL(fromUrl).hostname,
    ...(fromIcon ? { fromIcon } : {}),
    ...(fromTint ? { fromTint } : {}),
    fromUrl,
    at: Date.now(),
    state: "pending",
  };
  requests.set(request.id, request);
  recent.push(Date.now());
  return { requestId: request.id };
}

/// The token crosses only after approval, to the holder of the single-use claim.
export function pairStatus(id: string): {
  state: PairState;
  token?: string;
  deviceId?: string;
  name?: string;
  icon?: string;
  tint?: string;
  url?: string;
} {
  sweep();
  const request = requests.get(id);
  if (!request) return { state: "expired" };
  if (request.state !== "approved") return { state: request.state };

  // Single use: the answer carries a token, so it is given out once.
  requests.delete(id);
  return {
    state: "approved",
    token: config.token,
    deviceId,
    name: thisMachineName(),
    icon: thisMachineIcon(),
    ...(thisMachineTint() ? { tint: thisMachineTint() } : {}),
    url: request.approvedUrl ?? "",
  };
}

/// Requests waiting on a person here.
export function pendingPairRequests(): PairRequestView[] {
  sweep();
  return [...requests.values()]
    .filter((request) => request.state === "pending")
    .sort((a, b) => a.at - b.at);
}

export function pairRequest(id: string): PairRequest | undefined {
  sweep();
  return requests.get(id);
}

/// A person here said yes. `url` is this machine's own address, which the
/// asking machine needs in order to call back.
export function approvePair(id: string, url: string): PairRequest {
  sweep();
  const request = requests.get(id);
  if (!request || request.state !== "pending") throw new Error("that request is no longer waiting");
  const approved: PairRequest = { ...request, state: "approved", approvedUrl: url };
  requests.set(id, approved);
  return approved;
}

export function denyPair(id: string): void {
  sweep();
  const request = requests.get(id);
  if (!request) return;
  requests.set(id, { ...request, state: "denied" });
}

/// Forgets every request and every rate-limit record. Only the tests call this:
/// the caps are deliberately process-wide, which is right for a daemon and
/// would otherwise make one test's flood decide the next test's answer.
export function resetPairing(): void {
  requests.clear();
  recent.length = 0;
}

// --- The asking side ------------------------------------------------------

/// A pairing this machine started, waiting on a person at the other end.
///
/// The polling lives here rather than in a client because a client cannot reach
/// the other machine: a browser has no CORS headers to work with there, and the
/// token it would need does not exist yet. So this daemon asks, waits, and does
/// the storing once the answer comes back.
export interface PairAttempt {
  id: string;
  code: string;
  /// Where we reached that machine — the address discovery actually probed.
  url: string;
  name: string;
  remoteRequestId: string;
  at: number;
  state: "waiting" | "approved" | "denied" | "expired" | "failed";
  error?: string;
  peerId?: string;
}

const attempts = new Map<string, PairAttempt>();
const ATTEMPT_TIMEOUT_MS = 6_000;

export type AttemptView = Omit<PairAttempt, "remoteRequestId">;

function view(attempt: PairAttempt): AttemptView {
  const { remoteRequestId: _id, ...rest } = attempt;
  return rest;
}

async function callUnauthenticated<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    ...(init.body === undefined ? {} : { headers: { "Content-Type": "application/json" } }),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  const answer = await response.text();
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(answer) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {
      if (answer && answer.length < 200) message = answer;
    }
    throw new Error(message);
  }
  return (answer ? JSON.parse(answer) : null) as T;
}

/// Asks a machine to pair, and mints the code a person will compare. Answers
/// the code so this machine can show it beside the one shown over there.
export async function startPairing(input: {
  url: unknown;
  name?: unknown;
  self: { url: string; name: string; icon?: string; tint?: string };
}): Promise<AttemptView> {
  const url = peerAddress(input.url);
  const code = mintCode();
  if (!input.self.url) {
    throw new Error("turn on Reachable from your devices first, so it can answer back");
  }

  const asked = await callUnauthenticated<{ requestId?: string }>(`${url}/pair/request`, {
    method: "POST",
    body: {
      deviceId,
      name: input.self.name,
      icon: input.self.icon,
      tint: input.self.tint,
      url: input.self.url,
      code,
    },
  });
  if (!asked.requestId) throw new Error("that machine did not take the request");

  const attempt: PairAttempt = {
    id: randomUUID(),
    code,
    url,
    name: text(input.name, 80) || (new URL(url).hostname.split(".")[0] ?? url),
    remoteRequestId: asked.requestId,
    at: Date.now(),
    state: "waiting",
  };
  attempts.set(attempt.id, attempt);
  return view(attempt);
}

/// Where an attempt has got to. On approval this is also what finishes the job:
/// the answer carries that machine's token, so the peer is stored here and this
/// machine announces itself back, leaving a pair rather than a one-way link.
export async function checkPairing(
  id: string,
  complete: (claim: {
    deviceId: string;
    name: string;
    icon?: string;
    tint?: string;
    url: string;
    token: string;
  }) => Promise<{ id: string }>,
): Promise<AttemptView> {
  const attempt = attempts.get(id);
  if (!attempt) throw new Error("that pairing is no longer waiting");
  if (attempt.state !== "waiting") return view(attempt);

  if (Date.now() - attempt.at > TTL_MS) {
    const timedOut: PairAttempt = { ...attempt, state: "expired" };
    attempts.set(id, timedOut);
    return view(timedOut);
  }

  let answer: {
    state?: string;
    token?: string;
    deviceId?: string;
    name?: string;
    icon?: string;
    tint?: string;
  };
  try {
    answer = await callUnauthenticated(
      `${attempt.url}/pair/status?id=${encodeURIComponent(attempt.remoteRequestId)}`,
    );
  } catch {
    // A machine that went to sleep mid-ask is not a failed pairing yet; the
    // next poll tries again, and the deadline above ends it eventually.
    return view(attempt);
  }

  if (answer.state === "denied" || answer.state === "expired") {
    const closed: PairAttempt = { ...attempt, state: answer.state };
    attempts.set(id, closed);
    return view(closed);
  }
  if (answer.state !== "approved" || !answer.token || !answer.deviceId) return view(attempt);

  try {
    // The address we probed, not the one it reports: this one is known to work
    // from here, which is the only thing that matters for calling it.
    const peer = await complete({
      deviceId: answer.deviceId,
      name: answer.name || attempt.name,
      icon: answer.icon,
      tint: answer.tint,
      url: attempt.url,
      token: answer.token,
    });
    const done: PairAttempt = { ...attempt, state: "approved", peerId: peer.id };
    attempts.set(id, done);
    return view(done);
  } catch (error) {
    const failed: PairAttempt = {
      ...attempt,
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    attempts.set(id, failed);
    return view(failed);
  }
}

export function forgetPairing(id: string): void {
  attempts.delete(id);
}
