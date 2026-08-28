import { deviceId } from "./board-log.js";
import { dmChatFor, sendChatMessage } from "./chat.js";
import { config } from "./config.js";
import { callPeer, getPeer, peerViews } from "./peers.js";
import { dueRoutines, getRoutine, recordRoutineRun, type RoutineView } from "./routines.js";

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

async function sendOnDevice(routine: RoutineView, target: string): Promise<void> {
  if (target === deviceId) {
    const chat = dmChatFor(routine.agentId);
    await sendChatMessage(chat.id, routine.prompt);
    return;
  }
  const peer = getPeer(target);
  if (!peer) throw new Error("that device is unavailable");
  const opened = await callPeer(peer, `/agents/${encodeURIComponent(routine.agentId)}/dm`, { method: "POST" }) as {
    chat?: { id?: string };
  };
  const chatId = opened.chat?.id;
  if (!chatId) throw new Error("that device could not open the agent");
  await callPeer(peer, `/chats/${encodeURIComponent(chatId)}/message`, {
    method: "POST",
    body: { text: routine.prompt },
  });
}

export async function runRoutine(
  id: string,
  options: { devices?: string[]; send?: (routine: RoutineView, target: string) => Promise<void> } = {},
): Promise<RoutineView> {
  const routine = getRoutine(id);
  if (!routine) throw new Error("no such routine");
  let lastError: unknown;
  for (const target of options.devices ?? preferredDevices()) {
    try {
      await (options.send ?? sendOnDevice)(routine, target);
      return recordRoutineRun(id);
    } catch (error) {
      lastError = error;
    }
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
