import type { ModelChoice } from "./providers";
/// What a new thread starts on before you pick: your default for the computer,
/// then `fallback` — the provider's own default. There is no account-wide or
/// workspace default between them.
export function resolveModelDefault(computer: ModelChoice | null | undefined, fallback: ModelChoice): ModelChoice {
  return computer?.provider ? computer : fallback;
}
