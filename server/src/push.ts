import { apnsCredentials, apnsDeviceToken, sendApns } from "./apns.js";
import { db } from "./db.js";

/// iPhones that have asked this machine to Push when a thread needs you and
/// no window is open. The phone is a client of this daemon, not a peer — it
/// holds no repos of its own — so the tokens live here rather than in `peers`.

export interface PushDevice {
  token: string;
  name: string;
  registeredAt: number;
  lastSeen: number;
}

function toDevice(row: Record<string, unknown>): PushDevice {
  return {
    token: String(row.token),
    name: String(row.name),
    registeredAt: Number(row.registered_at),
    lastSeen: Number(row.last_seen),
  };
}

export function listPushDevices(): PushDevice[] {
  const rows = db
    .prepare("select token, name, registered_at, last_seen from push_devices order by last_seen desc")
    .all() as Record<string, unknown>[];
  return rows.map(toDevice);
}

export function pushStatus(): { configured: boolean; devices: PushDevice[] } {
  return { configured: Boolean(apnsCredentials()), devices: listPushDevices() };
}

/// A phone showing itself. The token is the whole identity; a rename of the
/// same token updates the row rather than adding a second.
export function registerPushDevice(input: Record<string, unknown>): PushDevice {
  const token = apnsDeviceToken(input.token);
  if (!token) throw new Error("that is not an Apple Push token");
  const name = typeof input.name === "string" && input.name.trim()
    ? input.name.trim().slice(0, 80)
    : "iPhone";
  const now = Date.now();
  const existing = db.prepare("select registered_at from push_devices where token = ?").get(token) as
    | { registered_at?: number }
    | undefined;
  const registeredAt = existing?.registered_at ?? now;
  db.prepare(
    `insert into push_devices(token, name, registered_at, last_seen)
     values (?, ?, ?, ?)
     on conflict(token) do update set name = excluded.name, last_seen = excluded.last_seen`,
  ).run(token, name, registeredAt, now);
  return { token, name, registeredAt, lastSeen: now };
}

export function forgetPushDevice(token: string): boolean {
  const normalized = apnsDeviceToken(token);
  if (!normalized) return false;
  const result = db.prepare("delete from push_devices where token = ?").run(normalized);
  return Number(result.changes) > 0;
}

function dropToken(token: string): void {
  db.prepare("delete from push_devices where token = ?").run(token);
}

/// Reasons that mean this token will never work again, so keeping it would
/// only produce the same error on every notification.
const DEAD = new Set(["BadDeviceToken", "Unregistered", "ExpiredProviderToken", "DeviceTokenNotForTopic"]);

export async function sendPush(evt: {
  session: string;
  title: string;
  message: string;
  highPriority: boolean;
  click?: string;
  device?: string;
  deviceId?: string;
}): Promise<void> {
  const devices = listPushDevices();
  if (devices.length === 0) return;
  if (!apnsCredentials()) {
    console.error("Apple Push is not configured; dropping a notification that would have reached the phone.");
    return;
  }
  const title = evt.device ? `${evt.title} · ${evt.device}` : evt.title;
  const click = evt.click ?? `remy://chat/${encodeURIComponent(evt.session)}`;
  await Promise.all(
    devices.map(async (device) => {
      const result = await sendApns({
        token: device.token,
        title,
        body: evt.message || evt.title,
        click,
        session: evt.session,
        deviceId: evt.deviceId,
        highPriority: evt.highPriority,
      });
      if (!result.ok && DEAD.has(result.reason)) dropToken(device.token);
      else if (!result.ok) console.error(`Apple Push failed: ${result.status} ${result.reason}`);
    }),
  );
}
