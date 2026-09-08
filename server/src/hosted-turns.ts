export type CheckpointTurn = {
  id: string;
  messageId: string;
  waiting: boolean;
};
export const restartPrompt = (waiting: boolean) =>
  waiting
    ? "Your computer restarted while you were waiting for input. Ask your pending question or request permission again; the restart grants no approval."
    : "Your computer restarted during your turn. Inspect existing results and continue the unfinished work without repeating completed actions.";

export async function checkpointTurns(
  threads: { id: string; state: string }[],
  save: (turns: CheckpointTurn[]) => void,
  interrupt: (id: string) => Promise<void>,
) {
  const turns = threads
    .filter((t) => t.state === "working" || t.state === "needs_input")
    .map((t) => ({
      id: t.id,
      messageId: `u-${crypto.randomUUID()}`,
      waiting: t.state === "needs_input",
    }));
  save(turns);
  await Promise.all(turns.map((t) => interrupt(t.id)));
}

export async function resumeCheckpointTurns(
  turns: CheckpointTurn[],
  save: (turns: CheckpointTurn[]) => void,
  send: (id: string, prompt: string, messageId: string) => Promise<void>,
) {
  for (const turn of turns) {
    await send(turn.id, restartPrompt(turn.waiting), turn.messageId);
    save((turns = turns.filter((t) => t.messageId !== turn.messageId)));
  }
}
