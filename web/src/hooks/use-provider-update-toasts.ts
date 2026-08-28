import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useStore } from "@/state/store";
import type { ToolStatus } from "@/state/types";

const POLL_MS = 60 * 60_000;
const FOCUS_FLOOR_MS = 5 * 60_000;
const DISMISSALS_KEY = "remy.provider-update-dismissals.v1";
const TOAST_ID = "provider-updates-available";
const seenUpdateKeys = new Set<string>();
let activeUpdateKey: string | undefined;

interface ProviderUpdate {
  id: string;
  label: string;
  current: string;
  latest: string;
}

function dismissedUpdateKeys(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSALS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function dismissUpdateKey(key: string): void {
  try {
    const keys = dismissedUpdateKeys();
    if (keys.includes(key)) return;
    localStorage.setItem(DISMISSALS_KEY, JSON.stringify([...keys.slice(-49), key]));
  } catch {
    // The toast remains dismissed for this window when storage is unavailable.
  }
}

function availableUpdate(id: string, label: string, status?: ToolStatus): ProviderUpdate | undefined {
  if (!status?.updateAvailable || !status.version || !status.latestVersion) return undefined;
  return { id, label, current: status.version, latest: status.latestVersion };
}

function updateDescription(updates: ProviderUpdate[]): string {
  if (updates.length === 1) {
    const update = updates[0]!;
    return `${update.label} ${update.latest} is newer than ${update.current} on this machine.`;
  }
  const versions = updates.map((update) => `${update.label} ${update.latest}`);
  const list = `${versions.slice(0, -1).join(", ")} and ${versions.at(-1)}`;
  return `${list} are newer than the versions on this machine.`;
}

export function useProviderUpdateToasts(onOpenProviders: () => void) {
  const servers = useStore((state) => state.servers);
  const settings = useStore((state) => state.settings);
  const tooling = useStore((state) => state.tooling);
  const loadTooling = useStore((state) => state.loadTooling);
  const localOnline = servers.some((server) => server.local && server.online);

  useEffect(() => {
    if (!localOnline) return;
    let checkedAt = 0;
    const check = () => {
      checkedAt = Date.now();
      void loadTooling().catch(() => {
        // A provider update check never makes an otherwise healthy machine look offline.
      });
    };
    check();
    const timer = window.setInterval(check, POLL_MS);
    const onFocus = () => {
      if (Date.now() - checkedAt >= FOCUS_FLOOR_MS) check();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadTooling, localOnline]);

  const enabled = useMemo(() => new Set(settings?.enabledProviders ?? []), [settings?.enabledProviders]);
  const updates = useMemo(() => [
    enabled.has("claude") ? availableUpdate("claude", "Claude Code", tooling?.claude) : undefined,
    enabled.has("codex") ? availableUpdate("codex", "Codex", tooling?.codex) : undefined,
    enabled.has("cursor") ? availableUpdate("cursor", "Cursor", tooling?.cursor) : undefined,
  ].filter((update): update is ProviderUpdate => Boolean(update)), [enabled, tooling]);
  const updateKey = updates.map((update) => `${update.id}:${update.latest}`).sort().join("|");

  const openProviders = useCallback(() => {
    if (updateKey) dismissUpdateKey(updateKey);
    toast.dismiss(TOAST_ID);
    onOpenProviders();
  }, [onOpenProviders, updateKey]);

  useEffect(() => {
    if (activeUpdateKey && activeUpdateKey !== updateKey) {
      toast.dismiss(TOAST_ID);
      activeUpdateKey = undefined;
    }
    if (!updateKey) {
      toast.dismiss(TOAST_ID);
      return;
    }
    if (seenUpdateKeys.has(updateKey) || dismissedUpdateKeys().includes(updateKey)) return;
    seenUpdateKeys.add(updateKey);
    activeUpdateKey = updateKey;
    toast.warning(updates.length === 1 ? `${updates[0]!.label} has an update.` : "Providers have updates.", {
      id: TOAST_ID,
      description: updateDescription(updates),
      duration: Infinity,
      closeButton: true,
      action: { label: "Open providers", onClick: openProviders },
      onDismiss: () => {
        if (activeUpdateKey === updateKey) activeUpdateKey = undefined;
        dismissUpdateKey(updateKey);
      },
    });
  }, [openProviders, updateKey, updates]);
}
