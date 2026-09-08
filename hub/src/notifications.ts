import {
  canReadThread,
  type HubNotification,
  type HubNotificationInput,
  type HubThread,
} from "@remy/contract";
import { D1AccountStore } from "./account-store.js";
import { D1ComputerStore } from "./computer-store.js";
import { ComputerService } from "./computers.js";
import { D1OrganizationStore } from "./organization-store.js";

export interface ApplePushConfig {
  APNS_KEY?: SecretsStoreSecret;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_TOPIC?: string;
  BETTER_AUTH_URL?: string;
}
const encoded = (data: string | Uint8Array) =>
  btoa(typeof data === "string" ? data : String.fromCharCode(...data))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export async function sendApplePush(
  config: ApplePushConfig,
  token: string,
  environment: string,
  notification: HubNotification,
  organizationId: string,
  send: typeof fetch = fetch,
): Promise<"sent" | "invalid" | "retry"> {
  if (
    !config.APNS_KEY ||
    !config.APNS_KEY_ID ||
    !config.APNS_TEAM_ID ||
    !config.APNS_TOPIC
  )
    return "retry";
  const pem = await config.APNS_KEY.get();
  const der = Uint8Array.from(
    atob(pem.replace(/-----[^-]+-----|\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const unsigned = `${encoded(JSON.stringify({ alg: "ES256", kid: config.APNS_KEY_ID }))}.${encoded(JSON.stringify({ iss: config.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }))}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(unsigned),
    ),
  );
  const host =
    environment === "sandbox"
      ? "api.sandbox.push.apple.com"
      : "api.push.apple.com";
  const response = await send(`https://${host}/3/device/${token}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${unsigned}.${encoded(signature)}`,
      "apns-topic": config.APNS_TOPIC,
      "apns-push-type": "alert",
      "apns-priority": notification.highPriority ? "10" : "5",
      "apns-id": notification.id,
      "apns-collapse-id": notification.id,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      aps: {
        alert: { title: notification.title, body: notification.message },
        sound: "default",
        "thread-id": notification.threadId,
      },
      organizationId,
      computerId: notification.computerId,
      threadId: notification.threadId,
      hubUrl: config.BETTER_AUTH_URL,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.ok) return "sent";
  const reason = (await response.json().catch(() => ({}))) as {
    reason?: string;
  };
  return response.status === 410 ||
    ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(reason.reason ?? "")
    ? "invalid"
    : "retry";
}

export class HubNotifications {
  constructor(
    private readonly db: D1Database,
    private readonly thread: (
      computerId: string,
      threadId: string,
    ) => Promise<HubThread | undefined>,
  ) {}

  private async allowed(
    org: string,
    user: string,
    computerId: string,
    threadId: string,
  ) {
    const organizations = new D1OrganizationStore(this.db);
    if (!(await organizations.membership(org, user))) return false;
    const computers = new D1ComputerStore(this.db);
    const computer = await computers.computer(org, computerId);
    const thread = await this.thread(computerId, threadId);
    return (
      !!computer &&
      !!thread &&
      canReadThread(thread.access, user) &&
      (await new ComputerService(
        computers,
        Date.now,
        "0.1.0",
        organizations,
      ).canReadWorkspace(computer, user, thread.detail.cwd))
    );
  }

  async raise(
    org: string,
    computerId: string,
    input: HubNotificationInput,
  ): Promise<string[] | undefined> {
    const thread = await this.thread(computerId, input.threadId);
    const computer = await new D1ComputerStore(this.db).computer(
      org,
      computerId,
    );
    if (!thread || !computer || thread.access.organizationId !== org)
      return undefined;
    await this.db
      .prepare(
        "DELETE FROM hub_notifications WHERE organization_id=? AND created_at<?",
      )
      .bind(org, Date.now() - 7 * 86400000)
      .run();
    const recipients = new Set([
      thread.access.owner.id,
      ...thread.access.participants.map((member) => member.id),
    ]);
    const addressed: string[] = [];
    for (const user of recipients) {
      if (!(await this.allowed(org, user, computerId, input.threadId)))
        continue;
      addressed.push(user);
      const payload: HubNotification = {
        ...input,
        computerId,
        computerName: computer.name,
        readAt: null,
      };
      // The persisted receipt makes computer retries idempotent, including push fan-out.
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO hub_notifications (id,organization_id,computer_id,thread_id,user_id,payload,created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
          )
          .bind(
            input.id,
            org,
            computerId,
            input.threadId,
            user,
            JSON.stringify(payload),
            Date.now(),
          ),
      ]);
    }
    return addressed;
  }

  async list(org: string, user: string): Promise<HubNotification[]> {
    const rows = await this.db
      .prepare(
        "SELECT payload,read_at FROM hub_notifications WHERE organization_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100",
      )
      .bind(org, user)
      .all<{ payload: string; read_at: number | null }>();
    const result: HubNotification[] = [];
    for (const row of rows.results) {
      const notification = JSON.parse(row.payload) as HubNotification;
      if (
        await this.allowed(
          org,
          user,
          notification.computerId,
          notification.threadId,
        )
      )
        result.push({ ...notification, readAt: row.read_at });
    }
    return result;
  }

  async read(org: string, user: string, id: string) {
    await this.db
      .prepare(
        "UPDATE hub_notifications SET read_at=? WHERE organization_id=? AND user_id=? AND id=?",
      )
      .bind(Date.now(), org, user, id)
      .run();
  }

  async deliver(
    org: string,
    config: ApplePushConfig,
    send = sendApplePush,
  ): Promise<void> {
    const rows = await this.db
      .prepare(
        `SELECT p.*,d.token,d.environment,d.session_id,d.enabled,n.payload,n.read_at FROM notification_pushes p JOIN member_push_devices d ON d.id=p.device_id JOIN hub_notifications n ON n.organization_id=p.organization_id AND n.id=p.notification_id AND n.user_id=p.user_id WHERE p.organization_id=? AND p.next_attempt_at<=? LIMIT 50`,
      )
      .bind(org, Date.now())
      .all<Record<string, unknown>>();
    for (const row of rows.results) {
      const notification = JSON.parse(String(row.payload)) as HubNotification;
      const session = (
        await new D1AccountStore(this.db).sessionsFor(String(row.user_id))
      ).find((s) => s.id === row.session_id);
      let outcome: "sent" | "invalid" | "retry" = "sent";
      if (
        row.enabled &&
        !row.read_at &&
        session &&
        !session.revokedAt &&
        Math.max(session.accessExpiresAt, session.refreshExpiresAt ?? 0) >
          Date.now() &&
        (await this.allowed(
          org,
          String(row.user_id),
          notification.computerId,
          notification.threadId,
        ))
      ) {
        try {
          outcome = await send(
            config,
            String(row.token),
            String(row.environment),
            notification,
            org,
          );
        } catch {
          outcome = "retry";
        }
      }
      const keys = [org, row.notification_id, row.user_id, row.device_id];
      if (outcome === "invalid")
        await this.db
          .prepare("DELETE FROM member_push_devices WHERE id=?")
          .bind(row.device_id)
          .run();
      else if (outcome === "retry" && Number(row.attempts) < 8)
        await this.db
          .prepare(
            "UPDATE notification_pushes SET attempts=attempts+1,next_attempt_at=? WHERE organization_id=? AND notification_id=? AND user_id=? AND device_id=?",
          )
          .bind(
            Date.now() +
              Math.min(3_600_000, 30_000 * 2 ** Number(row.attempts)),
            ...keys,
          )
          .run();
      else
        await this.db
          .prepare(
            "DELETE FROM notification_pushes WHERE organization_id=? AND notification_id=? AND user_id=? AND device_id=?",
          )
          .bind(...keys)
          .run();
    }
  }
}
