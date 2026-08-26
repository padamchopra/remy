import { createHmac, timingSafeEqual } from "node:crypto";
import { hostname } from "node:os";
import { deviceId, eventsSince, mergeRemote, onLocalAppend, versionVector } from "./board-log.js";
import { config, hasTailscaleServePreference, patchSettings } from "./config.js";
import { db } from "./db.js";
import { exportEnvironmentSync, mergeEnvironmentSync } from "./environments.js";
import { reprojectAll as reprojectAgents, seedPresetAgents } from "./agents.js";
import { reprojectAll as reprojectProjects } from "./projects.js";
import { reprojectAll as reprojectRecurrences } from "./recurring.js";
import { reprojectAll as reprojectTickets } from "./tickets.js";
import { serveTarget, tailnetSelf, tailscale, type TailnetState } from "./tailnet.js";

/// The other machines this one is paired with.
///
/// A peer is a whole Remy — its own daemon, its own repos, its own threads —
/// not a client of this one. Pairing is therefore symmetric: each side stores
/// the other's address and the token it needs to call it, and neither is in
/// charge. What crosses the link is the board log, which converges without a
/// coordinator, and notifications, which are addressed rather than broadcast.
///
/// This lives in the daemon rather than in a client so that pairing a machine
/// once pairs it for every window onto that daemon — the desktop app, the
/// browser, and the phone — and so that the sync loop runs whether or not
/// anybody is looking.

export interface Peer {
  id: string;
  name: string;
  url: string;
  token: string;
  icon?: string;
  tint?: string;
  /// Whether notifications raised on this machine are routed to that one.
  notify: boolean;
  pairedAt: number;
  lastSeen?: number;
}

/// A peer as a client sees it. The token never leaves the daemon.
export type PeerView = Omit<Peer, "token"> & { online: boolean };

/// How this machine introduces itself, and what a peer needs to call it back.
export interface Identity {
  deviceId: string;
  name: string;
  icon: string;
  tint?: string;
  url: string;
  token: string;
}

/// A peer is online if it answered recently. The sync loop runs well inside
/// this, so a peer that has gone quiet is genuinely unreachable rather than
/// merely between polls.
const ONLINE_MS = 90_000;
const SYNC_EVERY_MS = 15_000;
const SYNC_LIMIT = 500;
/// Long enough for a sleepy laptop to wake and answer, short enough that one
/// unreachable peer does not hold up the others in the same round.
const REQUEST_TIMEOUT_MS = 8_000;

/// What this machine calls itself. The hostname, without the `.local` a Mac
/// appends, because that is the name a person recognises.
export function thisMachineName(): string {
  return config.deviceName || hostname().replace(/\.local$/, "");
}

const DEVICE_ICONS = new Set(["laptop", "monitor", "smartphone", "tablet", "server", "house"]);
const DEVICE_TINTS = new Set(["zinc", "red", "orange", "amber", "green", "teal", "blue", "violet", "pink"]);

function peerAppearance(value: unknown, allowed: Set<string>): string | undefined {
  const picked = typeof value === "string" ? value.trim() : "";
  return allowed.has(picked) ? picked : undefined;
}

export function thisMachineIcon(): string {
  return peerAppearance(config.deviceIcon, DEVICE_ICONS) ?? "laptop";
}

export function thisMachineTint(): string | undefined {
  return peerAppearance(config.deviceTint, DEVICE_TINTS);
}

function toPeer(row: Record<string, unknown>): Peer {
  return {
    id: String(row.id),
    name: String(row.name),
    url: String(row.url),
    token: String(row.token),
    ...(row.icon ? { icon: String(row.icon) } : {}),
    ...(row.tint ? { tint: String(row.tint) } : {}),
    notify: Number(row.notify) === 1,
    pairedAt: Number(row.paired_at),
    ...(row.last_seen ? { lastSeen: Number(row.last_seen) } : {}),
  };
}

export function listPeers(): Peer[] {
  const rows = db
    .prepare("select * from peers order by name asc, id asc")
    .all() as Record<string, unknown>[];
  return rows.map(toPeer);
}

export function getPeer(id: string): Peer | undefined {
  const row = db.prepare("select * from peers where id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? toPeer(row) : undefined;
}

export function peerViews(): PeerView[] {
  const now = Date.now();
  return listPeers().map(({ token: _token, ...peer }) => ({
    ...peer,
    online: peer.lastSeen !== undefined && now - peer.lastSeen < ONLINE_MS,
  }));
}

/// Where a peer's address has to point. The daemon answers on loopback only, so
/// the reachable address is whatever fronts it — `tailscale serve` on the
/// tailnet, in practice. Anything that is not plain HTTP is not that.
export function peerAddress(value: unknown): string {
  if (typeof value !== "string") throw new Error("that link has no server address");
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("that is not a server address");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("a device address starts with http:// or https://");
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function peerToken(value: unknown): string {
  const token = typeof value === "string" ? value.trim() : "";
  if (!token) throw new Error("that link has no token");
  return token;
}

function peerName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? value.trim().slice(0, 80) : "";
  return name || fallback;
}

/// One call to a peer, with its token and a deadline. The peer's own error
/// sentence is preserved, because it is the one worth showing.
export async function callPeer<T>(
  peer: Pick<Peer, "url" | "token">,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    rawBody?: Buffer;
    filename?: string;
    contentType?: string;
    peerAuth?: boolean;
  } = {},
): Promise<T> {
  if (init.body !== undefined && init.rawBody !== undefined) throw new Error("a peer request has one body");
  const signal = AbortSignal.timeout(init.rawBody ? 120_000 : REQUEST_TIMEOUT_MS);
  const method = init.method ?? "GET";
  const timestamp = String(Date.now());
  const peerSignature = init.peerAuth
    ? createHmac("sha256", config.token)
      .update(`remy-peer:${deviceId}:${method}:${path}:${timestamp}`)
      .digest("base64url")
    : undefined;
  const requestBody: BodyInit | undefined = init.rawBody
    ? init.rawBody.buffer.slice(
      init.rawBody.byteOffset,
      init.rawBody.byteOffset + init.rawBody.byteLength,
    ) as ArrayBuffer
    : init.body === undefined ? undefined : JSON.stringify(init.body);
  // Concatenated rather than resolved against a base: a root-relative path
  // resolved against `https://host/remy` would drop the `/remy`, and a peer
  // behind a path prefix is exactly the shape `tailscale serve` can produce.
  const response = await fetch(`${peer.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${peer.token}`,
      ...(peerSignature ? {
        "X-Remy-Peer": deviceId,
        "X-Remy-Peer-Time": timestamp,
        "X-Remy-Peer-Signature": peerSignature,
      } : {}),
      ...(init.rawBody ? {
        "Content-Type": init.contentType ?? "application/octet-stream",
        "X-Filename": init.filename ?? "image",
      } : init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(requestBody === undefined ? {} : { body: requestBody }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    if (response.status === 401) message = "that token was refused";
    else {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        if (text && text.length < 200) message = text;
      }
    }
    throw new Error(message);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/// Proves a sensitive sync request came from a paired daemon rather than a
/// browser that can use this machine's ordinary API proxy.
export function isAuthenticatedPeerRequest(
  headers: Record<string, string | string[] | undefined>,
  method: string,
  path: string,
): boolean {
  const from = Array.isArray(headers["x-remy-peer"]) ? headers["x-remy-peer"]?.[0] : headers["x-remy-peer"];
  const timestamp = Array.isArray(headers["x-remy-peer-time"])
    ? headers["x-remy-peer-time"]?.[0]
    : headers["x-remy-peer-time"];
  const signature = Array.isArray(headers["x-remy-peer-signature"])
    ? headers["x-remy-peer-signature"]?.[0]
    : headers["x-remy-peer-signature"];
  const at = Number(timestamp);
  const peer = from ? getPeer(from) : undefined;
  if (!peer || !timestamp || !signature || !Number.isFinite(at) || Math.abs(Date.now() - at) > 60_000) return false;
  const expected = Buffer.from(createHmac("sha256", peer.token)
    .update(`remy-peer:${from}:${method}:${path}:${timestamp}`)
    .digest("base64url"));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function upsert(peer: Peer): Peer {
  db.prepare(
    `insert into peers (id, name, url, token, icon, tint, notify, paired_at, last_seen)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       url = excluded.url,
       token = excluded.token`,
  ).run(
    peer.id,
    peer.name,
    peer.url,
    peer.token,
    peer.icon ?? null,
    peer.tint ?? null,
    peer.notify ? 1 : 0,
    peer.pairedAt,
    peer.lastSeen ?? null,
  );
  return getPeer(peer.id) ?? peer;
}

function seen(id: string): void {
  db.prepare("update peers set last_seen = ? where id = ?").run(Date.now(), id);
}

export function updatePeer(
  id: string,
  patch: { name?: unknown; icon?: unknown; tint?: unknown; notify?: unknown },
): PeerView {
  const peer = getPeer(id);
  if (!peer) throw new Error("that device is not paired");
  if (patch.name !== undefined) {
    const name = peerName(patch.name, peer.name);
    db.prepare("update peers set name = ? where id = ?").run(name, id);
  }
  if (patch.icon !== undefined) {
    const icon = peerAppearance(patch.icon, DEVICE_ICONS) ?? null;
    db.prepare("update peers set icon = ? where id = ?").run(icon, id);
  }
  if (patch.tint !== undefined) {
    const tint = peerAppearance(patch.tint, DEVICE_TINTS) ?? null;
    db.prepare("update peers set tint = ? where id = ?").run(tint, id);
  }
  if (patch.notify !== undefined) {
    db.prepare("update peers set notify = ? where id = ?").run(patch.notify ? 1 : 0, id);
  }
  const view = peerViews().find((item) => item.id === id);
  if (!view) throw new Error("that device is not paired");
  return view;
}

export function removePeer(id: string): void {
  db.prepare("delete from peers where id = ?").run(id);
}

// --- This machine's own identity ------------------------------------------

export interface IdentityView {
  deviceId: string;
  name: string;
  /// Empty until something fronts the daemon — until then no peer can reach it.
  url: string;
  token: string;
  icon: string;
  tint?: string;
  configured: { name: boolean; icon: boolean; tint: boolean };
  /// Whether `tailscale serve` is carrying this daemon right now.
  exposed: boolean;
  /// This machine's tailnet name, whether or not it is being served.
  tailnetHost?: string;
  /// Why there is no name, when there is none: Tailscale is not installed here,
  /// or it is installed and not running. A switch that cannot be turned on
  /// should say which.
  tailnet: TailnetState;
}

/// How this machine introduces itself. The token is in here because the caller
/// already holds it — asking is how a person copies the link for another
/// device, and the answer is only ever given to an authorised request.
export async function identity(): Promise<IdentityView> {
  const { state, host } = await tailnetSelf();
  const serve = host ? await serveTarget() : undefined;
  const url = host && serve ? (serve.https ? `https://${host}` : `http://${host}:${config.port}`) : "";
  return {
    deviceId,
    name: thisMachineName(),
    icon: thisMachineIcon(),
    ...(thisMachineTint() ? { tint: thisMachineTint() } : {}),
    url,
    token: config.token,
    configured: {
      name: Boolean(config.deviceName),
      icon: Boolean(config.deviceIcon),
      tint: Boolean(config.deviceTint),
    },
    exposed: Boolean(url),
    tailnet: state,
    ...(host ? { tailnetHost: host } : {}),
  };
}

export async function updateIdentity(patch: Record<string, unknown>): Promise<IdentityView> {
  patchSettings({
    ...(patch.name !== undefined ? { deviceName: patch.name } : {}),
    ...(patch.icon !== undefined ? { deviceIcon: patch.icon } : {}),
    ...(patch.tint !== undefined ? { deviceTint: patch.tint } : {}),
  });
  if (typeof patch.exposed === "boolean") return setExposed(patch.exposed);
  return identity();
}

/// Puts this daemon on the tailnet, the same way `deploy/setup.sh` does. Serve,
/// never funnel: the tailnet can reach it, the public internet cannot.
export async function setExposed(on: boolean): Promise<IdentityView> {
  // Remember the desired state separately from the mapping Tailscale happens
  // to have right now. A restart can repair a missing or stale mapping only if
  // it knows that this machine was meant to stay reachable.
  patchSettings({ tailscaleServeEnabled: on });
  // Prefer HTTPS; fall back to tailnet HTTP for a tailnet without certs, which
  // is still WireGuard-encrypted and still tailnet-only, just without TLS on
  // top. Turning it off removes the mappings one at a time rather than running
  // `serve reset`: this machine may be serving something that is not Remy.
  const attempts = on
    ? [
        ["serve", "--bg", "--https=443", `http://127.0.0.1:${config.port}`],
        ["serve", "--bg", `--http=${config.port}`, `http://127.0.0.1:${config.port}`],
      ]
    : [
        ["serve", "--https=443", "off"],
        ["serve", `--http=${config.port}`, "off"],
      ];

  for (const args of attempts) {
    const ran = (await tailscale(args)) !== undefined;
    // Turning on stops at the first listener that takes it; turning off has to
    // clear every form it might have been turned on with.
    if (ran && on) break;
  }

  const next = await identity();
  if (next.exposed !== on) {
    if (next.tailnet === "missing") throw new Error("Tailscale isn't installed on this machine.");
    if (next.tailnet === "stopped") throw new Error("Tailscale isn't running on this machine.");
    throw new Error(
      on
        ? "Tailscale would not serve this machine. Check `tailscale serve status`."
        : "Tailscale would not stop serving this machine. Check `tailscale serve status`.",
    );
  }
  return next;
}

const EXPOSURE_RECONCILE_MS = 30_000;
let exposureReconcile: Promise<void> | undefined;

/// Keeps the Tailnet route aligned with the daemon's current port.
///
/// Existing installs already have a persistent Tailscale Serve rule but did
/// not store the preference that created it. The first current build adopts a
/// rule only when it demonstrably fronts this daemon; after that the explicit
/// preference decides whether startup may recreate it.
export async function reconcileTailnetExposure(): Promise<void> {
  if (hasTailscaleServePreference() && !config.tailscaleServeEnabled) return;

  const current = await serveTarget();
  if (!hasTailscaleServePreference()) {
    if (!current) return;
    patchSettings({ tailscaleServeEnabled: true });
  }
  if (!config.tailscaleServeEnabled || current) return;
  await setExposed(true);
}

/// Starts one non-overlapping reconciliation loop for the life of the daemon.
export function startTailnetExposureReconciler(): () => void {
  const run = () => {
    if (exposureReconcile) return;
    exposureReconcile = reconcileTailnetExposure()
      .catch((error) => {
        console.warn("remy: could not repair Tailnet reachability", error);
      })
      .finally(() => {
        exposureReconcile = undefined;
      });
  };
  run();
  const timer = setInterval(run, EXPOSURE_RECONCILE_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

// --- Pairing ---------------------------------------------------------------

/// Pairs with the machine behind a link, from this side and from theirs.
///
/// One paste is enough for both directions: we ask who they are, store them,
/// and then hand them our own address and token so they can call us too. A
/// pairing that only went one way would sync one way, which is not a pair.
export async function pairWith(input: Record<string, unknown>): Promise<PeerView> {
  const url = peerAddress(input.url);
  const token = peerToken(input.token);

  const them = await callPeer<Partial<IdentityView>>({ url, token }, "/server/identity");
  const id = typeof them.deviceId === "string" ? them.deviceId : "";
  if (!id) throw new Error("that machine is not running Remy");
  if (id === deviceId) throw new Error("that link is for this machine");

  return completePair({
    deviceId: id,
    name: peerName(input.name ?? them.name, new URL(url).hostname),
    icon: them.icon,
    tint: them.tint,
    url,
    token,
  });
}

/// Stores a machine as a peer and completes the other half of the pair.
///
/// Both ways in end here — a link you pasted, and an approval on the other
/// machine — because from this point they are the same thing: we hold that
/// machine's address and token, and it needs ours to call back. A machine that
/// cannot be reached back still pairs: it can pull from us, and the sync loop
/// keeps trying.
export async function completePair(claim: {
  deviceId: string;
  name?: string;
  icon?: string;
  tint?: string;
  url: string;
  token: string;
}): Promise<PeerView> {
  if (!claim.deviceId) throw new Error("that machine is not running Remy");
  if (claim.deviceId === deviceId) throw new Error("that is this machine");

  const url = peerAddress(claim.url);
  const peer = upsert({
    id: claim.deviceId,
    name: peerName(claim.name, new URL(url).hostname),
    ...(peerAppearance(claim.icon, DEVICE_ICONS) ? { icon: peerAppearance(claim.icon, DEVICE_ICONS) } : {}),
    ...(peerAppearance(claim.tint, DEVICE_TINTS) ? { tint: peerAppearance(claim.tint, DEVICE_TINTS) } : {}),
    url,
    token: peerToken(claim.token),
    notify: false,
    pairedAt: Date.now(),
    lastSeen: Date.now(),
  });

  const mine = await identity();
  if (mine.exposed) {
    try {
      await callPeer(peer, "/peers/announce", {
        method: "POST",
        body: {
          deviceId: mine.deviceId,
          name: mine.name,
          icon: mine.icon,
          tint: mine.tint,
          url: mine.url,
          token: mine.token,
        },
      });
    } catch {
      // Their half can also be completed from over there.
    }
  }

  await syncWithPeer(peer);
  const view = peerViews().find((item) => item.id === peer.id);
  if (!view) throw new Error("that device did not pair");
  return view;
}

/// A peer telling us who it is, so the pair works in both directions. The
/// request already carried this machine's token, which is what authorises it.
export function acceptAnnouncement(body: Record<string, unknown>): PeerView {
  const id = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
  if (!id) throw new Error("that announcement has no device");
  if (id === deviceId) throw new Error("that announcement is from this machine");
  const url = peerAddress(body.url);
  const peer = upsert({
    id,
    name: peerName(body.name, new URL(url).hostname),
    ...(peerAppearance(body.icon, DEVICE_ICONS) ? { icon: peerAppearance(body.icon, DEVICE_ICONS) } : {}),
    ...(peerAppearance(body.tint, DEVICE_TINTS) ? { tint: peerAppearance(body.tint, DEVICE_TINTS) } : {}),
    url,
    token: peerToken(body.token),
    notify: false,
    pairedAt: Date.now(),
    lastSeen: Date.now(),
  });
  const view = peerViews().find((item) => item.id === peer.id);
  if (!view) throw new Error("that device did not pair");
  return view;
}

// --- Reaching a peer on a client's behalf ---------------------------------

/// One request forwarded to a peer.
///
/// Clients only ever talk to the daemon on their own machine: a browser cannot
/// reach a peer directly (no CORS headers there, and the notify upgrade wants a
/// header a browser socket cannot set), and a peer's token is deliberately not
/// something a client holds. So the local daemon makes the call.
export async function proxyToPeer<T>(
  peerId: string,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    rawBody?: Buffer;
    filename?: string;
    contentType?: string;
  } = {},
): Promise<T> {
  const peer = getPeer(peerId);
  if (!peer) throw new Error("that device is not paired");
  try {
    const result = await callPeer<T>(peer, path, init);
    seen(peer.id);
    return result;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

// --- Board sync -----------------------------------------------------------

interface SyncAnswer {
  deviceId?: string;
  events?: unknown;
  have?: Record<string, number>;
}

/// One round with one peer: take what they have that we do not, then hand back
/// what we have that they do not.
///
/// Both sides run this on their own timer, so either half alone converges
/// eventually. Doing both here means a change shows up on the other machine in
/// one round rather than two.
async function syncWithPeer(peer: Peer): Promise<number> {
  const answer = await callPeer<SyncAnswer>(peer, "/peers/sync", {
    method: "POST",
    body: { have: versionVector(), limit: SYNC_LIMIT },
  });
  seen(peer.id);

  const landed = mergeRemote(answer.events);
  if (landed > 0) reprojectBoard();

  const theirs = answer.have && typeof answer.have === "object" ? answer.have : {};
  const outgoing = eventsSince(theirs, SYNC_LIMIT);
  if (outgoing.length > 0) {
    await callPeer(peer, "/peers/events", { method: "POST", body: { events: outgoing } });
  }
  try {
    const environmentAnswer = await callPeer<{ records?: unknown }>(peer, "/peers/environments/sync", {
      method: "POST",
      body: { records: exportEnvironmentSync() },
      peerAuth: true,
    });
    return landed + mergeEnvironmentSync(environmentAnswer.records);
  } catch (error) {
    // A machine on the previous release still syncs its board; environments
    // join once it upgrades instead of making the whole pairing look offline.
    if (/\b404\b/.test(error instanceof Error ? error.message : String(error))) return landed;
    throw error;
  }
}

/// What this machine answers a peer's sync with: their gaps, and our own cursor
/// so they know what to send back.
export function syncAnswer(body: Record<string, unknown>): SyncAnswer {
  const have = body.have && typeof body.have === "object" && !Array.isArray(body.have)
    ? (body.have as Record<string, number>)
    : {};
  const limit = Math.min(Number(body.limit) || SYNC_LIMIT, SYNC_LIMIT);
  return { deviceId, events: eventsSince(have, limit), have: versionVector() };
}

/// Events pushed to us by a peer. Answers how many were new, so the caller can
/// tell a no-op round from a real one.
export function acceptEvents(body: Record<string, unknown>): number {
  const landed = mergeRemote(body.events);
  if (landed > 0) reprojectBoard();
  return landed;
}

/// Replays every fold over the merged log. The board's tables are projections,
/// so this is how a peer's events become tickets, agents and projects here.
function reprojectBoard(): void {
  reprojectProjects();
  reprojectAgents();
  reprojectTickets();
  reprojectRecurrences();
  seedPresetAgents();
}

let syncTimer: ReturnType<typeof setInterval> | undefined;
let requestedSync: ReturnType<typeof setTimeout> | undefined;
let syncing = false;
let onBoardChange: (() => void) | undefined;

/// Pulls from every paired machine, forever. Rounds never overlap: a peer on a
/// slow link would otherwise have a second round stacked on the first.
export function startPeerSync(onChange: () => void): void {
  onBoardChange = onChange;
  if (syncTimer) return;
  onLocalAppend(() => {
    if (requestedSync) return;
    requestedSync = setTimeout(() => {
      requestedSync = undefined;
      void syncNow();
    }, 100);
    requestedSync.unref?.();
  });
  syncTimer = setInterval(() => void syncNow(), SYNC_EVERY_MS);
  syncTimer.unref?.();
  void syncNow();
}

export async function syncNow(): Promise<number> {
  if (syncing) return 0;
  const peers = listPeers();
  if (peers.length === 0) return 0;
  syncing = true;
  try {
    const rounds = await Promise.all(
      peers.map(async (peer) => {
        try {
          return await syncWithPeer(peer);
        } catch {
          // A peer that is asleep or off the tailnet is not an error to report;
          // it shows as offline, and the next round tries again.
          return 0;
        }
      }),
    );
    const landed = rounds.reduce((sum, count) => sum + count, 0);
    if (landed > 0) onBoardChange?.();
    return landed;
  } finally {
    syncing = false;
  }
}

// --- Notifications --------------------------------------------------------

/// The paired machines that notifications raised here are routed to.
export function notifyPeers(): Peer[] {
  return listPeers().filter((peer) => peer.notify);
}

/// Hands a notification to the machines it is addressed to. Each peer decides
/// how to show it — a banner in a window that is open there, or its own phone
/// push if nothing is.
export async function forwardNotification(payload: Record<string, unknown>): Promise<void> {
  const peers = notifyPeers();
  if (peers.length === 0) return;
  // Stamped on the way out, so the machine that shows the banner can say where
  // the thread actually is. A payload that already names one keeps it.
  const body = { ...payload, device: payload.device ?? thisMachineName() };
  await Promise.all(
    peers.map(async (peer) => {
      try {
        await callPeer(peer, "/peers/notify", { method: "POST", body });
        seen(peer.id);
      } catch {
        // A machine that cannot be reached cannot be buzzed. The one that
        // raised this still shows it if it is a target itself.
      }
    }),
  );
}
