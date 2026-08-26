import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const exec = promisify(execFile);

/// What this machine can learn about the tailnet it is on, and which of the
/// machines there are running Remy.
///
/// The point is that none of this needs pairing first. Tailscale already knows
/// every device you own and which of them are up, so Remy can offer you a list
/// to pick from instead of asking you to carry a link between two machines.

/// Candidate paths for the Tailscale CLI. The GUI builds keep it inside the app
/// bundle, where it is on nobody's PATH — and `/usr/local/bin/tailscale` is a
/// two-line shell script pointing back into that bundle, so both spellings of
/// the binary are worth trying on a case-sensitive disk.
const TAILSCALE_PATHS = [
  "tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
];

/// The environment the CLI runs in.
///
/// The macOS app ships one binary that is both the app and the command, and it
/// decides which it is being asked for by looking for a shell around it — `TERM`
/// and `SHLVL` are each enough. Finding neither it opens the window instead, and
/// when it cannot it prints "The Tailscale GUI failed to start" on stdout and
/// exits **0**, so the caller is handed a sentence where it asked for JSON.
///
/// Remy's daemon has no shell around it: Electron starts it, or launchd does.
/// What hid this is `/usr/local/bin/tailscale`, a `#!/bin/sh` shim into the
/// bundle — `sh` sets `TERM=dumb` itself when nothing else has, so a machine
/// with the shim worked and a machine without it did not. On an install that
/// never writes the shim, the Mac App Store build among them, the bundle path is
/// the only candidate left and every call came back as that sentence: Tailscale
/// reported as absent on a machine running it, with the switch that puts it on
/// the tailnet greyed out and blaming Tailscale for being off.
const CLI_ENV = { ...process.env, TERM: process.env.TERM || "dumb" };

/// Runs the Tailscale CLI, or answers undefined when no candidate could.
///
/// Every path gets its turn. One that is missing, refuses, or turns out not to
/// be this CLI says nothing about the next one, so a single bad candidate is
/// not allowed to stand in for "Tailscale is not on this machine".
export async function tailscale(args: string[]): Promise<string | undefined> {
  for (const bin of TAILSCALE_PATHS) {
    try {
      const { stdout } = await exec(bin, args, { timeout: 5_000, maxBuffer: 8 * 1024 * 1024, env: CLI_ENV });
      return stdout;
    } catch {
      continue;
    }
  }
  return undefined;
}

/// The CLI's answer, when it is the JSON that was asked for.
///
/// Anything else is a binary that ran and replied with something other than an
/// answer — prose from the app trying to open a window, most of all — and that
/// is not a status, so it is not treated as one.
async function tailscaleJson<T>(args: string[]): Promise<T | undefined> {
  const stdout = await tailscale(args);
  if (!stdout) return undefined;
  try {
    const parsed = JSON.parse(stdout) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

export interface StatusPeer {
  DNSName?: string;
  HostName?: string;
  OS?: string;
  Online?: boolean;
  UserID?: number;
  TailscaleIPs?: string[];
}

export interface Status {
  /// `Running` once Tailscale is up and signed in. `Stopped`, `NeedsLogin` and
  /// `NoState` are all installed-but-not-carrying-traffic.
  BackendState?: string;
  TailscaleIPs?: string[];
  Self?: StatusPeer;
  Peer?: Record<string, StatusPeer>;
}

async function status(): Promise<Status | undefined> {
  return tailscaleJson<Status>(["status", "--json"]);
}

/// Where Tailscale stands on this machine, which is three answers rather than
/// one: it is not installed, it is installed and not running, or it is up and
/// this machine has an address on the tailnet.
export type TailnetState = "missing" | "stopped" | "running";

export interface TailnetSelf {
  state: TailnetState;
  /// This machine's tailnet name, or its tailnet address on a tailnet with
  /// MagicDNS turned off. Only ever set when the state is `running`.
  host?: string;
}

/// This machine's own place on the tailnet, from a status Tailscale gave us.
///
/// Split out from the call so the shapes Tailscale answers with can be tested
/// without a tailnet to answer them.
export function selfFromStatus(parsed: Status | undefined): TailnetSelf {
  if (!parsed) return { state: "missing" };
  if (parsed.BackendState !== "Running") return { state: "stopped" };
  // MagicDNS is what gives a machine a name; a tailnet without it still gives
  // it an address, and an address is enough to be reached at.
  const dns = parsed.Self?.DNSName?.replace(/\.$/, "");
  const host = dns || parsed.Self?.TailscaleIPs?.[0] || parsed.TailscaleIPs?.[0];
  return host ? { state: "running", host } : { state: "stopped" };
}

export async function tailnetSelf(): Promise<TailnetSelf> {
  return selfFromStatus(await status());
}

/// This machine's name on the tailnet, without the trailing dot.
export async function tailnetHost(): Promise<string | undefined> {
  return (await tailnetSelf()).host;
}

/// Whether `tailscale serve` is fronting this daemon, and on which listener.
/// Serve is the only way in: the daemon itself binds loopback.
export interface ServeStatus {
  Web?: Record<string, {
    Handlers?: Record<string, { Proxy?: string }>;
  }>;
}

/// The listener that actually fronts this daemon. A different Tailscale Serve
/// rule on the same machine is not proof that Remy is reachable, and a stale
/// rule pointing at an older port is exactly the state startup must repair.
export function serveTargetFromStatus(
  parsed: ServeStatus | undefined,
  localPort = config.port,
): { https: boolean } | undefined {
  const expected = `http://127.0.0.1:${localPort}`;
  for (const [listener, web] of Object.entries(parsed?.Web ?? {})) {
    const matches = Object.values(web.Handlers ?? {}).some((handler) => {
      if (typeof handler.Proxy !== "string") return false;
      return handler.Proxy.replace(/\/$/, "") === expected;
    });
    if (matches) return { https: listener.endsWith(":443") };
  }
  return undefined;
}

export async function serveTarget(): Promise<{ https: boolean } | undefined> {
  return serveTargetFromStatus(
    await tailscaleJson<ServeStatus>(["serve", "status", "--json"]),
  );
}

/// A paired endpoint and a discovery result name the same Tailnet machine even
/// while the endpoint itself is returning a gateway error.
export function sameTailnetHost(endpoint: string, host: string): boolean {
  try {
    return new URL(endpoint).hostname.toLowerCase().replace(/\.$/, "")
      === host.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
}

export interface TailnetDevice {
  /// Full tailnet name, e.g. `padams-mac-mini.tail91cfc.ts.net`.
  host: string;
  /// The first label, which is what a person calls the machine.
  name: string;
  os: string;
  online: boolean;
}

/// A machine that could plausibly be running a Remy daemon. Phones and tablets
/// are on the tailnet too, and none of them hold repositories.
const DAEMON_PLATFORMS = new Set(["macos", "linux", "windows"]);

/// Your own machines on the tailnet, newest information Tailscale has.
///
/// Only devices belonging to the same tailnet user: a shared node or another
/// person's machine on the same tailnet is not somewhere to go looking for your
/// threads.
export function devicesFromStatus(parsed: Status | undefined): TailnetDevice[] {
  const mine = parsed?.Self?.UserID;
  if (!parsed?.Peer || mine === undefined) return [];

  const devices: TailnetDevice[] = [];
  for (const peer of Object.values(parsed.Peer)) {
    // Same as this machine's own address: a name when MagicDNS gives one, the
    // tailnet address when it does not.
    const dns = peer.DNSName?.replace(/\.$/, "");
    const host = dns || peer.TailscaleIPs?.[0];
    if (!host || peer.UserID !== mine) continue;
    const os = (peer.OS ?? "").toLowerCase();
    if (!DAEMON_PLATFORMS.has(os)) continue;
    devices.push({
      host,
      name: (dns ? dns.split(".")[0] : peer.HostName) || host,
      os,
      online: peer.Online === true,
    });
  }
  return devices.sort((a, b) => a.name.localeCompare(b.name));
}

export async function tailnetDevices(): Promise<TailnetDevice[]> {
  return devicesFromStatus(await status());
}

export interface Found extends TailnetDevice {
  /// Where Remy answered, ready to pair with. Absent when nothing did.
  url?: string;
}

/// How long a probe waits. A tailnet machine that is up answers well inside
/// this; one that is asleep never will, and must not hold up the others.
const PROBE_MS = 2_500;
const DISCOVERY_TTL_MS = 20_000;
let cached: { found: Found[]; at: number } | undefined;

/// Whether a Remy daemon answers at a base URL, and nothing more than that.
///
/// An unauthenticated `/health` is refused rather than answered — authorisation
/// runs before any route — so **401 is the positive signal**: something is
/// there, speaking Remy, and it wants a token we do not have yet. That is
/// exactly what we need to know before offering to pair with it, and it tells a
/// caller nothing it did not already know.
async function remyAnswers(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(PROBE_MS),
    });
    return response.status === 401 || response.status === 200;
  } catch {
    return false;
  }
}

/// The first address a machine answers Remy on. HTTPS first, because that is
/// what `tailscale serve` sets up when the tailnet has certificates.
async function probe(device: TailnetDevice): Promise<Found> {
  if (!device.online) return device;
  for (const base of [`https://${device.host}`, `http://${device.host}:${config.port}`]) {
    if (await remyAnswers(base)) return { ...device, url: base };
  }
  return device;
}

/// Every machine of yours on the tailnet, each marked with where Remy answered.
/// Cached briefly so a pane that polls does not reprobe the whole tailnet.
export async function discover(force = false): Promise<Found[]> {
  if (!force && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.found;
  const devices = await tailnetDevices();
  const found = await Promise.all(devices.map((device) => probe(device)));
  cached = { found, at: Date.now() };
  return found;
}
