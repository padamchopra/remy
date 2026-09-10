import { hostedSettingsSchema, type HostedSettings } from "@remy/contract";
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export class HostedSettingsStore {
  constructor(
    private readonly db: D1Database,
    private readonly rootSecret: () => Promise<string>,
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
