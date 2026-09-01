import type { Cadence, Routine } from "../state/types";

/// A routine's schedule as a sentence. Mirrors `web/src/lib/tickets.ts`, so the
/// same routine reads the same on the phone and in the window.

export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Every week",
  monthly: "Every month",
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/// A time of day in whatever the phone's clock reads as.
export function clockTime(hour: number, minute: number): string {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function cadenceSummary(routine: Pick<Routine, "cadence" | "hour" | "minute" | "weekday" | "day">): string {
  const time = clockTime(routine.hour, routine.minute);
  if (routine.cadence === "daily") return `Every day at ${time}`;
  if (routine.cadence === "weekdays") return `Every weekday at ${time}`;
  if (routine.cadence === "weekly") return `Every ${WEEKDAYS[routine.weekday ?? 1]} at ${time}`;
  return `Day ${routine.day ?? 1} of the month at ${time}`;
}
