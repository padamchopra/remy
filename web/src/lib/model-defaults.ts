import type { ModelChoice } from "./providers";
/// What a new thread starts on before you pick: the workspace's default, then
/// the computer's, then `fallback` — the provider's own default. There is no
/// account-wide default between them.
export function resolveModelDefault(workspace: ModelChoice | null | undefined, computer: ModelChoice | null | undefined, fallback: ModelChoice): ModelChoice {
  return workspace?.provider ? workspace : computer?.provider ? computer : fallback;
}
