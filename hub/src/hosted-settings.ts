import { cloudConnectionForKey, cloudConnectionSchema, publicCloudKeys } from "./cloud-connection.js";
import { hostedSettingsSchema, type HostedSettings } from "@remy/contract";
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export class HostedSettingsStore {
  constructor(
    private readonly db: D1Database,
    private readonly rootSecret: () => Promise<string>,
    readonly development?: Fetcher,
  ) {}
  async settings(org: string, workspace = ""): Promise<HostedSettings> {
    const defaults = await this.db
      .prepare(
        "SELECT settings FROM organization_hosted_settings WHERE organization_id=? AND workspace_id=''",
      )
      .bind(org)
      .first<{ settings: string }>();
    const overrides = workspace
      ? await this.db
          .prepare(
            "SELECT settings FROM organization_hosted_settings WHERE organization_id=? AND workspace_id=?",
          )
          .bind(org, workspace)
          .first<{ settings: string }>()
      : null;
    return hostedSettingsSchema.parse({
      ...JSON.parse(defaults?.settings ?? "{}"),
      ...JSON.parse(overrides?.settings ?? "{}"),
    });
  }
  async enabledProviders(org: string): Promise<HostedSettings["provider"][]> {
    const direct = Object.entries(await this.secrets(org)).flatMap(([key, value]) => {
      if (!key.startsWith("cloud:")) return [];
      const parsed = cloudConnectionSchema.safeParse(JSON.parse(value));
      return parsed.success && parsed.data.enabled ? [parsed.data.provider] : [];
    });
    const shared = (await this.db.prepare("SELECT source_organization_id,provider FROM organization_cloud_shares WHERE organization_id=?").bind(org).all<{source_organization_id:string;provider:HostedSettings["provider"]}>()).results;
    for (const row of shared) {
      const connection = await this.connection(row.source_organization_id, row.provider);
      if (connection?.enabled) direct.push(row.provider);
    }
    return [...new Set(direct)];
  }

  async ownConnection(org: string, provider: HostedSettings["provider"]) {
    const direct = (await this.secrets(org))[`cloud:${provider}`];
    if (!direct) return;
    const parsed = cloudConnectionSchema.safeParse(JSON.parse(direct));
    if (parsed.success && parsed.data.enabled) return parsed.data;
  }

  async connection(org: string, provider: HostedSettings["provider"]) {
    const direct = await this.ownConnection(org, provider);
    if (direct) return direct;
    const share = await this.cloudShare(org, provider);
    if (!share) return;
    const secrets = await this.secrets(share.source_organization_id);
    const allowed = parseIds(share.key_ids);
    const keys = publicCloudKeys(provider, secrets).filter((key) => !allowed || allowed.includes(key.id));
    const selected = keys.find((key) => key.active) ?? keys[0];
    return selected ? cloudConnectionForKey(provider, secrets, selected.id) : undefined;
  }

  /// First enabled Personal enrollment for this cloud provider.
  async cloudShare(org: string, provider: HostedSettings["provider"]) {
    const shares = await this.db.prepare("SELECT source_organization_id,shared_by,start_providers,key_ids FROM organization_cloud_shares WHERE organization_id=? AND provider=? ORDER BY created_at").bind(org, provider).all<{source_organization_id:string;shared_by:string;start_providers:string|null;key_ids:string|null}>();
    for (const share of shares.results) {
      const secrets = await this.secrets(share.source_organization_id);
      const allowed = parseIds(share.key_ids);
      const keys = publicCloudKeys(provider, secrets).filter((key) => !allowed || allowed.includes(key.id));
      if (keys.some((key) => cloudConnectionForKey(provider, secrets, key.id)?.enabled)) return share;
    }
  }

  /// Organization-owned model keys. Cloud placements never bring their
  /// owner's model credentials with them.
  async executionSecrets(org: string): Promise<Record<string, string>> {
    return this.secrets(org);
  }
  async executionSettings(org: string, workspace: string, provider?: HostedSettings["provider"]): Promise<HostedSettings> {
    const settings = await this.settings(org, workspace);
    const enabled = await this.enabledProviders(org);
    if (!enabled.length) throw new Error("Enable a cloud provider in Computers settings.");
    if (provider && !enabled.includes(provider)) throw new Error("This cloud provider is disabled; choose another computer.");
    return { ...settings, enabled: true, provider: provider ?? (enabled.includes(settings.provider) ? settings.provider : enabled.sort()[0]) };
  }
  async save(org: string, workspace: string, input: unknown) {
    if (input === null && workspace) {
      await this.db
        .prepare(
          "DELETE FROM organization_hosted_settings WHERE organization_id=? AND workspace_id=?",
        )
        .bind(org, workspace)
        .run();
      return;
    }
    const value = hostedSettingsSchema.parse(input);
    await this.db
      .prepare(
        "INSERT INTO organization_hosted_settings VALUES (?,?,?) ON CONFLICT(organization_id,workspace_id) DO UPDATE SET settings=excluded.settings",
      )
      .bind(org, workspace, JSON.stringify(value))
      .run();
  }
  private async key() {
    return crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(await this.rootSecret()),
      ),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  }
  async seal(scope:string,value:string) {
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const data=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:new TextEncoder().encode(scope)},await this.key(),new TextEncoder().encode(value));
    return `${encode(iv)}.${encode(new Uint8Array(data))}`;
  }
  async unseal(scope:string,value:string) {
    const [iv,data]=value.split(".");
    return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(iv),additionalData:new TextEncoder().encode(scope)},await this.key(),decode(data)));
  }
  async setSecret(org: string, name: string, value: string | null) {
    if (this.development) throw new Error("Edit this connection in Remy, then refresh your local preview.");
    if (value === null) {
      await this.db
        .prepare(
          "DELETE FROM organization_secrets WHERE organization_id=? AND name=?",
        )
        .bind(org, name)
        .run();
      return;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new TextEncoder().encode(`${org}:${name}`),
      },
      await this.key(),
      new TextEncoder().encode(value),
    );
    await this.db
      .prepare(
        "INSERT INTO organization_secrets VALUES (?,?,?) ON CONFLICT(organization_id,name) DO UPDATE SET ciphertext=excluded.ciphertext",
      )
      .bind(org, name, `${encode(iv)}.${encode(new Uint8Array(data))}`)
      .run();
  }
  async secretNames(org: string): Promise<string[]> {
    if (this.development) return Object.keys(await this.secrets(org));
    return (
      await this.db
        .prepare(
          "SELECT name FROM organization_secrets WHERE organization_id=?",
        )
        .bind(org)
        .all<{ name: string }>()
    ).results.map((r) => r.name);
  }
  async secrets(org: string): Promise<Record<string, string>> {
    if (this.development) {
      const response = await this.development.fetch(new Request("https://internal/secrets", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId: org }),
      }));
      if (!response.ok) throw new Error("Your production connection is unavailable. Try again.");
      return response.json();
    }
    const result: Record<string, string> = {};
    for (const row of (
      await this.db
        .prepare(
          "SELECT name,ciphertext FROM organization_secrets WHERE organization_id=?",
        )
        .bind(org)
        .all<{ name: string; ciphertext: string }>()
    ).results) {
      const [iv, data] = row.ciphertext.split(".");
      result[row.name] = new TextDecoder().decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decode(iv),
            additionalData: new TextEncoder().encode(`${org}:${row.name}`),
          },
          await this.key(),
          decode(data),
        ),
      );
    }
    return result;
  }
}

export function hostedSettingsFor(env: { DB: D1Database; AUTH_SECRET: { get(): Promise<string> }; DEVELOPMENT_CONNECTIONS?: Fetcher }) {
  return new HostedSettingsStore(env.DB, () => env.AUTH_SECRET.get(), env.DEVELOPMENT_CONNECTIONS);
}

function parseIds(value: string | null): string[] | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : [];
  } catch { return []; }
}
