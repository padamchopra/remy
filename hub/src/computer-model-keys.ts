import { z } from "zod";

/// Provider keys a person sets on a computer they already connected, so nobody
/// has to open a shell on that machine and sign Claude Code or Codex in by hand.
///
/// The value is only ever readable by the computer it belongs to: management
/// reads return the configured state, and the computer pulls the cleartext over
/// its own authenticated connection.
export const COMPUTER_MODEL_KEYS = [
  { id: "anthropic", label: "Anthropic", name: "ANTHROPIC_API_KEY", runtime: "Claude" },
  { id: "openai", label: "OpenAI", name: "OPENAI_API_KEY", runtime: "Codex" },
] as const;
export type ComputerModelKeyId = (typeof COMPUTER_MODEL_KEYS)[number]["id"];
export type ComputerModelKeyName = (typeof COMPUTER_MODEL_KEYS)[number]["name"];

export const computerModelKeyWrite = z.object({
  id: z.enum(COMPUTER_MODEL_KEYS.map((key) => key.id) as [ComputerModelKeyId, ...ComputerModelKeyId[]]),
  apiKey: z.string().trim().min(1).max(8192).nullable(),
}).strict();

export type PublicComputerModelKey = { id: ComputerModelKeyId; label: string; runtime: string; configured: boolean };

export function publicComputerModelKeys(names: string[]): PublicComputerModelKey[] {
  return COMPUTER_MODEL_KEYS.map(({ id, label, runtime, name }) => ({ id, label, runtime, configured: names.includes(name) }));
}

export function computerModelKeyName(id: ComputerModelKeyId): ComputerModelKeyName {
  return COMPUTER_MODEL_KEYS.find((key) => key.id === id)!.name;
}

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export class ComputerModelKeyStore {
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

  async names(computerId: string): Promise<string[]> {
    return (await this.db.prepare("SELECT name FROM computer_model_keys WHERE computer_id=? ORDER BY name").bind(computerId).all<{ name: string }>()).results.map((row) => row.name);
  }

  async set(computerId: string, name: ComputerModelKeyName, value: string | null): Promise<void> {
    if (value === null) {
      await this.db.prepare("DELETE FROM computer_model_keys WHERE computer_id=? AND name=?").bind(computerId, name).run();
      return;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`${computerId}:${name}`) },
      await this.key(),
      new TextEncoder().encode(value),
    );
    await this.db.prepare("INSERT INTO computer_model_keys (computer_id,name,ciphertext,updated_at) VALUES (?,?,?,?) ON CONFLICT(computer_id,name) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at")
      .bind(computerId, name, `${encode(iv)}.${encode(new Uint8Array(data))}`, this.now())
      .run();
  }

  /// Cleartext for the computer that owns these keys. The computer id is
  /// authenticated data, so a row copied to another computer cannot be read.
  async values(computerId: string): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    for (const row of (await this.db.prepare("SELECT name,ciphertext FROM computer_model_keys WHERE computer_id=? ORDER BY name").bind(computerId).all<{ name: string; ciphertext: string }>()).results) {
      const [iv, data] = row.ciphertext.split(".");
      values[row.name] = new TextDecoder().decode(await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(iv), additionalData: new TextEncoder().encode(`${computerId}:${row.name}`) },
        await this.key(),
        decode(data),
      ));
    }
    return values;
  }

  async forget(computerId: string): Promise<void> {
    await this.db.prepare("DELETE FROM computer_model_keys WHERE computer_id=?").bind(computerId).run();
  }
}
