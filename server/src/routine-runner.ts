import { readFile } from "node:fs/promises";
import { deviceId } from "./board-log.js";
import { dmChatFor, sendChatMessage } from "./chat.js";
import { config, expandHome } from "./config.js";
import { callPeer, getPeer, peerViews } from "./peers.js";
import { dueRoutines, getRoutine, recordRoutineRun, type RoutineView } from "./routines.js";

/// Whether the prompt reached the agent. A busy conversation is not a failed
/// device: the prompt would queue behind a turn the person is having.
export type RoutineDispatch = "sent" | "busy";

/// Raised when the agent's conversation is mid-turn. Nothing is sent and no run
/// is recorded, so the next tick tries again.
export class RoutineBusyError extends Error {}

function busy(state: string | undefined): boolean {
  return state === "working" || state === "needs_input";
}

export function orderedRoutineDevices(
  preferenceOrder: string[],
  availableIds: string[],
  localDeviceId: string,
): string[] {
  const available = new Set(availableIds);
  return [...new Set([...preferenceOrder, localDeviceId, ...available])]
    .filter((id) => available.has(id));
}

function preferredDevices(): string[] {
  const available = [
    deviceId,
    ...peerViews().filter((peer) => peer.online).map((peer) => peer.id),
  ];
  return orderedRoutineDevices(config.devicePreferenceOrder, available, deviceId);
}

/// What the routine says this time. A linked file is read on the machine that
/// owns the clock, so editing the file changes the next run and it is the text,
/// not the path, that travels to whichever device runs it.
async function routinePrompt(routine: RoutineView): Promise<string> {
  if (!routine.promptPath) return routine.prompt;
  let text: string;
  try {
    text = (await readFile(expandHome(routine.promptPath), "utf8")).trim();
  } catch {
    throw new Error(`could not read ${routine.promptPath}`);
  }
  if (!text) throw new Error(`${routine.promptPath} is empty`);
  return text.slice(0, 20_000);
}

/// What tells the agent this is its routine firing rather than something the
/// person typed. It rides beside the prompt as context, so the transcript still
/// shows only the instruction.
export function routineRunContext(routine: Pick<RoutineView, "name">): string {
  return [
    "<remy_routine_run>",
    `This is your routine "${routine.name}" firing on its cadence. Nobody typed this and nobody is waiting to answer a question.`,
    "Carry out the instruction now. If there is nothing to do this time, say so in one line and stop.",
    "</remy_routine_run>",
  ].join("\n");
}

async function sendOnDevice(routine: RoutineView, target: string, text: string): Promise<RoutineDispatch> {
  if (target === deviceId) {
    const chat = dmChatFor(routine.agentId);
    if (busy(chat.state)) return "busy";
    await sendChatMessage(chat.id, text, [], [], routineRunContext(routine));
    return "sent";
  }
  const peer = getPeer(target);
  if (!peer) throw new Error("that device is unavailable");
  const opened = await callPeer(peer, `/agents/${encodeURIComponent(routine.agentId)}/dm`, { method: "POST" }) as {
    chat?: { id?: string; state?: string };
  };
  const chatId = opened.chat?.id;
  if (!chatId) throw new Error("that device could not open the agent");
  if (busy(opened.chat?.state)) return "busy";
  await callPeer(peer, `/chats/${encodeURIComponent(chatId)}/message`, {
    method: "POST",
    body: { text, agentContext: routineRunContext(routine) },
  });
  return "sent";
}

export async function runRoutine(
  id: string,
  options: {
    devices?: string[];
    send?: (routine: RoutineView, target: string, text: string) => Promise<RoutineDispatch>;
  } = {},
): Promise<RoutineView> {
  const routine = getRoutine(id);
  if (!routine) throw new Error("no such routine");
  let text: string;
  try {
    text = await routinePrompt(routine);
  } catch (error) {
    const message = (error as Error).message || "could not read that instruction file";
    recordRoutineRun(id, message);
    throw new Error(message);
  }
  let lastError: unknown;
  for (const target of options.devices ?? preferredDevices()) {
    let outcome: RoutineDispatch;
    try {
      outcome = await (options.send ?? sendOnDevice)(routine, target, text);
    } catch (error) {
      lastError = error;
      continue;
    }
    // Trying the next machine instead would split one routine's history across
    // two conversations, so a busy agent ends the whole attempt.
    if (outcome === "busy") throw new RoutineBusyError("that agent is still working");
    return recordRoutineRun(id);
  }
  const message = (lastError as Error | undefined)?.message || "no device is available";
  recordRoutineRun(id, message);
  throw new Error(message);
}

export async function runDueRoutines(now = Date.now()): Promise<number> {
  let ran = 0;
  for (const routine of dueRoutines(now)) {
    try {
      await runRoutine(routine.id);
      ran += 1;
    } catch (error) {
      if (error instanceof RoutineBusyError) continue;
      console.error(`could not run the routine ${routine.name}:`, error);
    }
  }
  return ran;
}

let timer: NodeJS.Timeout | undefined;

export function startRoutines(onRan?: () => void): void {
  if (timer) return;
  timer = setInterval(() => {
    void runDueRoutines().then((ran) => {
      if (ran > 0) onRan?.();
    });
  }, 60_000);
  timer.unref();
}
