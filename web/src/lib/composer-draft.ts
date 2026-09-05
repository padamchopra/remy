const PREFIX = "remy.composer-draft:";
const NEW_THREAD_TARGET_KEY = "remy.new-thread-target";

export interface NewThreadTarget {
  workspaceId: string | null;
  serverId: string;
}

export function readComposerDraft(id: string): string {
  try {
    return sessionStorage.getItem(`${PREFIX}${id}`) ?? "";
  } catch {
    return "";
  }
}

export function writeComposerDraft(id: string, text: string): void {
  try {
    const key = `${PREFIX}${id}`;
    if (text) sessionStorage.setItem(key, text);
    else sessionStorage.removeItem(key);
  } catch {
    // Draft recovery is best effort when storage is unavailable.
  }
}

export function readNewThreadTarget(): NewThreadTarget | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(NEW_THREAD_TARGET_KEY) ?? "null") as Partial<NewThreadTarget> | null;
    if (!parsed || (parsed.workspaceId !== null && typeof parsed.workspaceId !== "string") || typeof parsed.serverId !== "string") {
      return undefined;
    }
    return { workspaceId: parsed.workspaceId, serverId: parsed.serverId };
  } catch {
    return undefined;
  }
}

export function writeNewThreadTarget(target: NewThreadTarget): void {
  try {
    localStorage.setItem(NEW_THREAD_TARGET_KEY, JSON.stringify(target));
  } catch {
    // The picker still works for this window when storage is unavailable.
  }
}
