import type { ModelChoice } from "./providers";
export function resolveModelDefault(workspace: ModelChoice | null | undefined, remy: ModelChoice | null | undefined, fallback: ModelChoice, computer?: ModelChoice | null): ModelChoice {
  return workspace?.provider ? workspace : computer?.provider ? computer : remy?.provider ? remy : fallback;
}
