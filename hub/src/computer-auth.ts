import { computerConnectionAuthorizationSchema, computerConnectionMessage } from "@remy/contract";
import type { ComputerStore, StoredComputer } from "./computer-store.js";

const MAX_CLOCK_SKEW_MS = 60_000;

function bytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  const result = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) result[index] = binary.charCodeAt(index);
  return result;
}

export async function authenticateComputer(
  request: Request,
  organizationId: string,
  store: ComputerStore,
  now: () => number = Date.now,
): Promise<StoredComputer | undefined> {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("RemyComputer ")) return undefined;
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(bytes(header.slice(13)))); } catch { return undefined; }
  const parsed = computerConnectionAuthorizationSchema.safeParse(input);
  if (!parsed.success || Math.abs(now() - parsed.data.timestamp) > MAX_CLOCK_SKEW_MS) return undefined;
  const computer = await store.computer(organizationId, parsed.data.computerId);
  if (!computer) return undefined;
  try {
    const key = await crypto.subtle.importKey("spki", bytes(computer.publicKey), { name: "Ed25519" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("Ed25519", key, bytes(parsed.data.signature), new TextEncoder().encode(computerConnectionMessage(organizationId, parsed.data)));
    if (!valid || !await store.claimNonce(computer.computerId, parsed.data.nonce, parsed.data.timestamp + MAX_CLOCK_SKEW_MS, now())) return undefined;
    return computer;
  } catch {
    return undefined;
  }
}
