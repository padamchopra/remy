import { getChat } from "./chat.js";
import { getKv, setKv } from "./db.js";

const OVERRIDES_KEY = "pullRequestMonitoringOverrides";

export type PullRequestMonitoringSource = "pull-request";

export interface PullRequestMonitoringPolicy {
  enabled: boolean;
  chatId: string | null;
  source: PullRequestMonitoringSource;
  explicit: boolean;
}

export interface PullRequestMonitoringOverride {
  enabled: boolean;
  chatId: string | null;
}

type PullRequestOverrides = Record<string, PullRequestMonitoringOverride>;

function key(repository: string, number: number): string {
  return `${repository.trim().toLowerCase()}#${number}`;
}

function valid(policy: PullRequestMonitoringOverride): PullRequestMonitoringOverride {
  if (policy.enabled !== true) return { enabled: false, chatId: null };
  const chatId = policy.chatId?.trim().slice(0, 128) || null;
  if (!chatId) throw new Error("pick the thread that should follow this pull request");
  if (!getChat(chatId)) throw new Error("no such thread");
  return { enabled: true, chatId };
}

/// A pull request is followed by one thread, or by nobody. A thread that is gone
/// takes its monitoring with it, so nothing keeps watching for a feed that has
/// nowhere to land.
function available(policy: PullRequestMonitoringOverride, explicit: boolean): PullRequestMonitoringPolicy {
  const chatId = policy.chatId && getChat(policy.chatId) ? policy.chatId : null;
  if (!chatId) return { enabled: false, chatId: null, source: "pull-request", explicit };
  return { enabled: policy.enabled, chatId, source: "pull-request", explicit };
}

export function pullRequestMonitoring(repository: string, number: number): PullRequestMonitoringPolicy {
  const override = (getKv<PullRequestOverrides>(OVERRIDES_KEY) ?? {})[key(repository, number)];
  return override
    ? available(override, true)
    : { enabled: false, chatId: null, source: "pull-request", explicit: false };
}

export function setPullRequestMonitoring(
  repository: string,
  number: number,
  policy: PullRequestMonitoringOverride,
): PullRequestMonitoringPolicy {
  const overrides = getKv<PullRequestOverrides>(OVERRIDES_KEY) ?? {};
  overrides[key(repository, number)] = valid(policy);
  setKv(OVERRIDES_KEY, overrides);
  return pullRequestMonitoring(repository, number);
}

export function resetPullRequestMonitoring(
  repository: string,
  number: number,
): PullRequestMonitoringPolicy {
  const overrides = getKv<PullRequestOverrides>(OVERRIDES_KEY) ?? {};
  delete overrides[key(repository, number)];
  setKv(OVERRIDES_KEY, overrides);
  return pullRequestMonitoring(repository, number);
}

export function hasPullRequestMonitoring(): boolean {
  const overrides = getKv<PullRequestOverrides>(OVERRIDES_KEY);
  return Boolean(overrides && Object.values(overrides).some((policy) => policy.enabled && policy.chatId));
}

export function clearThreadPullRequestMonitoring(chatId: string): void {
  const overrides = getKv<PullRequestOverrides>(OVERRIDES_KEY) ?? {};
  let changed = false;
  for (const [overrideKey, policy] of Object.entries(overrides)) {
    if (policy.chatId !== chatId) continue;
    overrides[overrideKey] = { enabled: false, chatId: null };
    changed = true;
  }
  if (changed) setKv(OVERRIDES_KEY, overrides);
}
