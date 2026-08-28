import { getAgent } from "./agents.js";
import { config, patchSettings } from "./config.js";
import { getKv, setKv } from "./db.js";
import {
  clearWorkspaceMonitoringAgent,
  hasWorkspacePullRequestMonitoring,
  updateWorkspace,
  workspaceMonitoringOverride,
  type PullRequestMonitoringOverride,
} from "./workspaces.js";

const OVERRIDES_KEY = "pullRequestMonitoringOverrides";

export type PullRequestMonitoringSource = "default" | "workspace" | "pull-request";

export interface PullRequestMonitoringPolicy {
  enabled: boolean;
  agentId: string | null;
  source: PullRequestMonitoringSource;
  explicit: boolean;
}

type PullRequestOverrides = Record<string, PullRequestMonitoringOverride>;

function key(repository: string, number: number): string {
  return `${repository.trim().toLowerCase()}#${number}`;
}

function valid(policy: PullRequestMonitoringOverride): PullRequestMonitoringOverride {
  const agentId = policy.agentId?.trim().slice(0, 128) || null;
  if (agentId && !getAgent(agentId)) throw new Error("no such agent");
  return { enabled: policy.enabled === true, agentId };
}

function available(policy: PullRequestMonitoringOverride, source: PullRequestMonitoringSource, explicit: boolean): PullRequestMonitoringPolicy {
  if (!policy.agentId || !getAgent(policy.agentId)) return { enabled: false, agentId: null, source, explicit };
  return { ...policy, source, explicit };
}

function globalPolicy(): PullRequestMonitoringOverride {
  return {
    enabled: config.pullRequestMonitoringEnabled,
    agentId: config.pullRequestMonitoringAgentId || null,
  };
}

export function workspacePullRequestMonitoring(workspaceId: string): PullRequestMonitoringPolicy {
  const override = workspaceMonitoringOverride(workspaceId);
  return available(override ?? globalPolicy(), override ? "workspace" : "default", Boolean(override));
}

export function pullRequestMonitoring(
  workspaceId: string,
  repository: string,
  number: number,
): PullRequestMonitoringPolicy {
  const override = (getKv<PullRequestOverrides>(OVERRIDES_KEY) ?? {})[key(repository, number)];
  if (override) return available(override, "pull-request", true);
  const inherited = workspacePullRequestMonitoring(workspaceId);
  return { ...inherited, explicit: false };
}

export async function setWorkspacePullRequestMonitoring(
  workspaceId: string,
  policy: PullRequestMonitoringOverride,
): Promise<PullRequestMonitoringPolicy> {
  await updateWorkspace(workspaceId, { pullRequestMonitoring: valid(policy) });
  return workspacePullRequestMonitoring(workspaceId);
}

export async function resetWorkspacePullRequestMonitoring(workspaceId: string): Promise<PullRequestMonitoringPolicy> {
  await updateWorkspace(workspaceId, { pullRequestMonitoring: null });
  return workspacePullRequestMonitoring(workspaceId);
}

export function setPullRequestMonitoring(
  workspaceId: string,
  repository: string,
  number: number,
  policy: PullRequestMonitoringOverride,
): PullRequestMonitoringPolicy {
  const overrides = getKv<PullRequestOverrides>(OVERRIDES_KEY) ?? {};
  overrides[key(repository, number)] = valid(policy);
  setKv(OVERRIDES_KEY, overrides);
  return pullRequestMonitoring(workspaceId, repository, number);
}

export function resetPullRequestMonitoring(
  workspaceId: string,
  repository: string,
  number: number,
): PullRequestMonitoringPolicy {
  const overrides = getKv<PullRequestOverrides>(OVERRIDES_KEY) ?? {};
  delete overrides[key(repository, number)];
  setKv(OVERRIDES_KEY, overrides);
  return pullRequestMonitoring(workspaceId, repository, number);
}

export function hasPullRequestMonitoring(): boolean {
  if (globalPolicy().enabled && globalPolicy().agentId) return true;
  if (hasWorkspacePullRequestMonitoring()) return true;
  const workspace = getKv<PullRequestOverrides>(OVERRIDES_KEY);
  if (workspace && Object.values(workspace).some((policy) => policy.enabled && policy.agentId)) return true;
  return false;
}

export function clearAgentPullRequestMonitoring(agentId: string): void {
  if (config.pullRequestMonitoringAgentId === agentId) {
    patchSettings({ pullRequestMonitoringEnabled: false, pullRequestMonitoringAgentId: "" });
  }
  clearWorkspaceMonitoringAgent(agentId);
  const overrides = getKv<PullRequestOverrides>(OVERRIDES_KEY) ?? {};
  let changed = false;
  for (const [overrideKey, policy] of Object.entries(overrides)) {
    if (policy.agentId !== agentId) continue;
    overrides[overrideKey] = { enabled: false, agentId: null };
    changed = true;
  }
  if (changed) setKv(OVERRIDES_KEY, overrides);
}
