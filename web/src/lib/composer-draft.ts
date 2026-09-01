const PREFIX = "remy.composer-draft:";

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
