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

/// The day the next run lands on. Only the day: the cadence beside it has
/// already said the hour, and saying it twice reads as two different facts.
export function whenNext(at: number): string {
  const due = new Date(at);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor((due.getTime() - midnight.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return WEEKDAYS[due.getDay()];
  return due.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(due.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

/// Just the hour, for a control that owns only the hour. Pairing it with a
/// minute control while it still says ":00" reads as two different times.
export function clockHour(hour: number): string {
  const at = new Date();
  at.setHours(hour, 0, 0, 0);
  return at.toLocaleTimeString(undefined, { hour: "numeric" });
}

export function cadenceSummary(routine: Pick<Routine, "cadence" | "hour" | "minute" | "weekday" | "day">): string {
  const time = clockTime(routine.hour, routine.minute);
  if (routine.cadence === "daily") return `Every day at ${time}`;
  if (routine.cadence === "weekdays") return `Every weekday at ${time}`;
  if (routine.cadence === "weekly") return `Every ${WEEKDAYS[routine.weekday ?? 1]} at ${time}`;
  return `Day ${routine.day ?? 1} of the month at ${time}`;
}
