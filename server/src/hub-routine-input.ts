import { z } from "zod";
export const hubRoutineInput = {
  name: z.string(),
  prompt: z.string(),
  projectId: z.string(),
  cadence: z.enum(["daily", "weekdays", "weekly", "monthly"]),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  weekday: z.number().int().min(0).max(6).optional(),
  day: z.number().int().min(1).max(31).optional(),
  timeZone: z.string().describe("IANA time zone, such as Asia/Kolkata."),
};
