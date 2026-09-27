const COMPUTER_NAME_MAX = 120;

export function hostedComputerName(
  workspaceName: string,
  computerId: string,
  task?: { title?: string | undefined },
) {
  const suffix = task ? ` · ${computerId.slice(0, 6)}` : "";
  const base = task?.title || (task ? workspaceName : `Codex for ${workspaceName}`);
  return `${base.slice(0, COMPUTER_NAME_MAX - suffix.length)}${suffix}`;
}
