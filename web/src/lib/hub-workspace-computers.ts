import type { ComputerSummary } from "@remy/contract";

export const normalizeRepositoryOrigin = (value: string) => value.trim().replace(/^\w+:\/\//, "").replace(/^git@/, "").replace(/:([^/])/, "/$1").replace(/\.git\/?$/, "").replace(/\/$/, "").toLowerCase();

export function workspaceComputers(origin: string, computers: ComputerSummary[]) {
  return computers.filter(computer => computer.capabilities.workspaces.some(workspace => !!workspace.origin && normalizeRepositoryOrigin(workspace.origin) === normalizeRepositoryOrigin(origin)));
}

