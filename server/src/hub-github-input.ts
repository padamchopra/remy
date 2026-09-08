import { z } from "zod";
export const hubGitHubInput = {
  workspaceId: z.string(),
  action: z.enum(["create", "comment", "review"]),
  number: z.number().int().positive().optional(),
  title: z.string().optional(),
  head: z.string().optional(),
  base: z.string().optional(),
  body: z.string().max(60000),
  event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]).optional(),
};
