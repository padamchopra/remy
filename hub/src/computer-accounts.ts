/// Encrypted account sessions for a computer the person already connected.
/// Management reads return configured state; the computer pulls the cleartext
/// over its own authenticated connection, the same way provider keys do.

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export class ComputerAccountStore {
  constructor(
    private readonly db: D1Database,
    private readonly rootSecret: () => Promise<string>,
    private readonly now: () => number = Date.now,
  ) {}

  private async key() {
    return crypto.subtle.importKey(
      "raw",
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(await this.rootSecret())),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  }

  async secrets(computerId: string): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    for (const row of (await this.db.prepare("SELECT name,ciphertext FROM computer_account_secrets WHERE computer_id=? ORDER BY name").bind(computerId).all<{ name: string; ciphertext: string }>()).results) {
      const [iv, data] = row.ciphertext.split(".");
      values[row.name] = new TextDecoder().decode(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(iv), additionalData: new TextEncoder().encode(`${computerId}:${row.name}`) },
        await this.key(),
        decode(data),
      ));
    }
    return values;
  }

  async setSecret(computerId: string, name: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.db.prepare("DELETE FROM computer_account_secrets WHERE computer_id=? AND name=?").bind(computerId, name).run();
      return;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${computerId}:${name}`) },
      await this.key(),
      new TextEncoder().encode(value),
    );
    await this.db.prepare("INSERT INTO computer_account_secrets (computer_id,name,ciphertext,updated_at) VALUES (?,?,?,?) ON CONFLICT(computer_id,name) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at")
      .bind(computerId, name, `${encode(iv)}.${encode(new Uint8Array(data))}`, this.now())
      .run();
  }

  async forget(computerId: string): Promise<void> {
    await this.db.prepare("DELETE FROM computer_account_secrets WHERE computer_id=?").bind(computerId).run();
  }
}
