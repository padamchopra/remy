import { useSyncExternalStore } from "react";

/// A workspace someone asked the new-thread composer to open on, such as New
/// thread on a workspace row. It waits until a composer that lists that
/// workspace takes it, then clears, so a later visit opens on its own default.
export type ComposerWorkspaceRequest = { organizationId: string; workspaceId: string };

let request: ComposerWorkspaceRequest | undefined;
const listeners = new Set<() => void>();

export function requestComposerWorkspace(next: ComposerWorkspaceRequest) {
  request = next;
  for (const listener of listeners) listener();
}

/// Clears the request once a composer has applied it.
export function takeComposerWorkspace(taken: ComposerWorkspaceRequest) {
  if (request !== taken) return;
  request = undefined;
  for (const listener of listeners) listener();
}

export function useComposerWorkspaceRequest(): ComposerWorkspaceRequest | undefined {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => request,
    () => undefined,
  );
}
