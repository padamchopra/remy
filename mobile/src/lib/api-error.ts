export function apiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // The transport already unwrapped some failures into a plain string.
  }
  return raw;
}

export function pairingError(error: unknown): string {
  if (statusOf(error) === 401) return "Scan a new pairing QR and try again.";
  const message = apiError(error);
  if (/network request failed|failed to fetch|load failed/i.test(message)) {
    return "Open Tailscale on this iPhone and try again.";
  }
  return message;
}

/// A failure that still knows the code it came back with. A 404 from a Mac on
/// an older build means "this one cannot do that", which reads differently from
/// "that failed" — and the sentence alone cannot be asked which it was.
export interface HttpError extends Error {
  status: number;
}

export function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/// True when the Mac that answered does not have this route at all.
export function isMissingRoute(error: unknown): boolean {
  return statusOf(error) === 404;
}

/// Turns a failed HTTP body into a sentence a person can act on. Tailscale
/// Serve answers empty 502s and HTML interstitials rather than Remy's JSON.
export function httpError(status: number, text: string): HttpError {
  const carry = (message: string): HttpError => Object.assign(new Error(message), { status });
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return carry(parsed.error);
  } catch {
    // Not JSON — Tailscale pages, empty 502s, raw text.
  }
  if (/not on (your |the )?tailnet|connect to your tailnet/i.test(text)) {
    return carry("This iPhone is not on your tailnet. Open Tailscale and try again.");
  }
  if (status === 502 || status === 503 || status === 504) {
    return carry("That Mac isn't running Remy.");
  }
  const trimmed = text.trim();
  if (trimmed && trimmed.length < 200 && !trimmed.startsWith("<")) return carry(trimmed);
  return carry(`Couldn't reach that Mac (${status}).`);
}

export function chatIdFrom(error: unknown): string | undefined {
  if (error && typeof error === "object" && "chatId" in error) {
    const id = (error as { chatId?: unknown }).chatId;
    if (typeof id === "string" && id) return id;
  }
  return undefined;
}
