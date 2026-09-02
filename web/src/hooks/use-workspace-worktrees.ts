import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { apiError } from "@/lib/api-error";
import { workspaceCopies } from "@/lib/projects";
import { transport } from "@/lib/transport";
import { cleanWorktreeSelection, worktreeCopyKey, worktreeKey, type WorktreeTarget } from "@/lib/worktree-selection";
import { useStore } from "@/state/store";
import type { GitWorktree, Workspace } from "@/state/types";

interface Snapshot { trees?: GitWorktree[]; loading?: boolean; error?: string }

export function useWorkspaceWorktrees(workspace: Workspace) {
  const allWorkspaces = useStore((state) => state.workspaces);
  const servers = useStore((state) => state.servers);
  const copies = workspaceCopies(workspace, allWorkspaces).sort((a, b) => {
    const first = servers.find((server) => server.id === a.serverId);
    const second = servers.find((server) => server.id === b.serverId);
    return Number(Boolean(second?.local)) - Number(Boolean(first?.local))
      || (first?.name ?? a.serverId).localeCompare(second?.name ?? b.serverId)
      || a.id.localeCompare(b.id);
  });
  const [snapshots, setSnapshots] = useState<Record<string, Snapshot>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<WorktreeTarget[] | null>(null);
  const [discardChanges, setDiscardChanges] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const mounted = useRef(true);
  const running = useRef(false);
  const inFlight = useRef(new Map<string, Promise<void>>());
  const refs = useRef({ copies, servers });
  refs.current = { copies, servers };
  const topology = JSON.stringify(copies.map((copy) => [copy.id, copy.serverId, servers.find((server) => server.id === copy.serverId)?.online]));

  const load = useCallback((copy: Workspace): Promise<void> => {
    const key = worktreeCopyKey(copy);
    if (inFlight.current.has(key)) return inFlight.current.get(key)!;
    if (!refs.current.servers.find((server) => server.id === copy.serverId)?.online) return Promise.resolve();
    setSnapshots((current) => ({ ...current, [key]: { ...current[key], loading: true } }));
    const request = useStore.getState().loadWorkspaceWorktrees(copy.id, copy.serverId)
      .then((trees) => {
        if (mounted.current) {
          setSnapshots((current) => ({ ...current, [key]: { trees } }));
          const missing = new Set(copy.worktrees.filter((tree) => !trees.some((next) => next.path === tree.path)).map((tree) => worktreeKey(copy.serverId, tree.path)));
          setSelected((current) => new Set([...current].filter((entry) => !missing.has(entry))));
          if (!running.current) setRemoved((current) => new Set([...current].filter((entry) =>
            !trees.some((tree) => worktreeKey(copy.serverId, tree.path) === entry))));
        }
      }).catch((cause) => {
        if (mounted.current) setSnapshots((current) => ({ ...current, [key]: { ...current[key], loading: false, error: apiError(cause) } }));
      }).finally(() => { inFlight.current.delete(key); });
    inFlight.current.set(key, request);
    return request;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => { for (const copy of refs.current.copies) void load(copy); }, [topology, load]);

  useEffect(() => {
    const refresh = (serverId?: string, workspaceId?: string) => {
      for (const copy of refs.current.copies) {
        if ((!serverId || copy.serverId === serverId) && (!workspaceId || copy.id === workspaceId)) {
          void load(copy);
        }
      }
    };
    const off = transport.subscribe((serverId, payload) => {
      const frame = payload as { type?: string; workspaceId?: string };
      if (frame.type === "workspace-worktrees") {
        // A read begun before a mutation must settle before its read-back.
        for (const copy of refs.current.copies) {
          if (copy.serverId !== serverId || copy.id !== frame.workspaceId) continue;
          void (inFlight.current.get(worktreeCopyKey(copy)) ?? Promise.resolve()).then(() => {
            if (mounted.current) void load(copy);
          });
        }
      }
      if (frame.type === "hello" || frame.type === "peer-reset") refresh(serverId);
    }, refs.current.copies.map((copy) => `workspace:${copy.id}`));
    const offStatus = transport.onStatus((serverId, online) => { if (online) refresh(serverId); });
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    // Git changes made outside Remy emit no live frame; only this open pane scans them.
    const timer = window.setInterval(() => { if (!document.hidden && !running.current) refresh(); }, 15_000);
    return () => { off(); offStatus(); window.removeEventListener("focus", onFocus); window.clearInterval(timer); };
  }, [load, topology]);

  const seen = new Set<string>();
  const groups = copies.map((copy) => {
    const server = servers.find((entry) => entry.id === copy.serverId);
    const snapshot = snapshots[worktreeCopyKey(copy)];
    const online = server?.online === true;
    const ready = online && Boolean(snapshot?.trees) && !snapshot?.error;
    const targets = (snapshot?.trees ?? copy.worktrees).flatMap((tree) => {
      const key = worktreeKey(copy.serverId, tree.path);
      if (seen.has(key) || removed.has(key)) return [];
      seen.add(key);
      return [{ key, workspaceId: copy.id, serverId: copy.serverId, deviceName: server?.name ?? "Unavailable device", tree }];
    });
    return { copy, server, snapshot, online, ready, targets };
  });
  const selectable = groups.flatMap((group) => group.ready ? group.targets.filter((target) => !target.tree.isMain) : []);
  const selectedTargets = groups.flatMap((group) => group.targets.filter((target) => selected.has(target.key)));
  const availableKeys = new Set(selectable.map((target) => target.key));
  const selectionReady = selectedTargets.length > 0 && selectedTargets.every((target) => availableKeys.has(target.key));
  const allSelected = selectable.length > 0 && selectable.every((target) => selected.has(target.key));

  const toggle = (key: string, checked: boolean) => setSelected((current) => {
    const next = new Set(current);
    if (checked) next.add(key); else next.delete(key);
    return next;
  });
  const confirm = (targets: WorktreeTarget[]) => {
    setConfirmation(targets.map((target) => ({ ...target, tree: { ...target.tree } })));
    setDiscardChanges(false);
    setErrors({});
  };
  const clean = async () => {
    if (!confirmation?.length || running.current) return;
    running.current = true;
    setBusy(true);
    let count = 0;
    const failures: WorktreeTarget[] = [];
    await cleanWorktreeSelection(confirmation, discardChanges, (target, force) =>
      useStore.getState().cleanWorkspaceWorktree(target.workspaceId, target.tree.path, force, target.serverId),
    (target, error) => {
      if (error) failures.push(target); else count++;
      if (!mounted.current) return;
      if (error) setErrors((current) => ({ ...current, [target.key]: apiError(error) }));
      else {
        setRemoved((current) => new Set(current).add(target.key));
        setSelected((current) => { const next = new Set(current); next.delete(target.key); return next; });
      }
    });
    if (mounted.current) {
      setConfirmation(null);
      setDiscardChanges(false);
      setBusy(false);
      if (count) toast.success(`Cleaned up ${count} ${count === 1 ? "worktree" : "worktrees"}.`);
      if (failures.length) toast.error(`Couldn't clean up ${failures.length} ${failures.length === 1 ? "worktree" : "worktrees"}`, { description: "Review the errors beside each worktree, then try again." });
      await Promise.all([...inFlight.current.values()]);
      running.current = false;
      for (const copy of refs.current.copies) void load(copy);
    }
    running.current = false;
  };

  return { groups, selected, selectedTargets, selectable, allSelected, selectionReady, busy, errors, confirmation,
    discardChanges, setDiscardChanges, toggle, confirm, clean, load,
    clear: () => setSelected(new Set()),
    selectAll: (checked: boolean) => setSelected(checked ? new Set(selectable.map((target) => target.key)) : new Set()),
    dismiss: () => { if (!running.current) setConfirmation(null); },
  };
}

export type WorkspaceWorktreeState = ReturnType<typeof useWorkspaceWorktrees>;
