import { getKv, setKv } from "./db.js";
import { openSecret, rememberSecrets, sealSecret } from "./environments.js";

/// Provider keys someone set on this computer from the web, so signing Claude
/// Code or Codex in never means opening a shell on the machine that holds the
/// repositories. Claude reads the first, Codex the second.
export const HUB_MODEL_KEY_NAMES = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;

const STORED = "hubModelKeys";
const VALUE_LIMIT = 8192;
const inherited = new Set<string>();

type Sealed = { ciphertext: string; iv: string; tag: string };

export function hubModelKeys(): Record<string, string> {
  const stored = getKv<Sealed>(STORED);
  if (!stored) return {};
  try {
    const values = JSON.parse(openSecret(stored)) as Record<string, string>;
    return Object.fromEntries(HUB_MODEL_KEY_NAMES.flatMap((name) => typeof values[name] === "string" && values[name] ? [[name, values[name]]] : []));
  } catch {
    return {};
  }
}

/// Providers Remy starts inherit this process's environment, and the machine's
/// own provider status is read the same way, so a key delivered here has to
/// reach both.
function inherit(values: Record<string, string>): void {
  for (const name of HUB_MODEL_KEY_NAMES) {
    if (values[name]) {
      process.env[name] = values[name];
      inherited.add(name);
    } else if (inherited.delete(name)) {
      delete process.env[name];
    }
  }
}

/// Accepts only the keys the hub delivered for this computer, and says whether
/// they changed so a running thread can be given the new ones.
export function applyHubModelKeys(input: unknown): boolean {
  const delivered = (input as { values?: unknown } | null)?.values;
  if (!delivered || typeof delivered !== "object" || Array.isArray(delivered)) throw new Error("Your provider keys could not be read.");
  const entries = Object.entries(delivered as Record<string, unknown>).filter(([name]) => (HUB_MODEL_KEY_NAMES as readonly string[]).includes(name));
  if (entries.some(([, value]) => typeof value !== "string" || !value || value.length > VALUE_LIMIT)) throw new Error("Your provider keys could not be read.");
  const values = Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))) as Record<string, string>;
  const changed = JSON.stringify(values) !== JSON.stringify(hubModelKeys());
  setKv(STORED, Object.keys(values).length ? sealSecret(JSON.stringify(values)) : null);
  rememberSecrets("hub-model-keys", Object.values(values));
  inherit(values);
  return changed;
}

/// Puts the keys this computer was already given back in place at startup.
export function restoreHubModelKeys(): void {
  const values = hubModelKeys();
  rememberSecrets("hub-model-keys", Object.values(values));
  inherit(values);
}

export function forgetHubModelKeys(): void {
  setKv(STORED, null);
  rememberSecrets("hub-model-keys", []);
  inherit({});
}
