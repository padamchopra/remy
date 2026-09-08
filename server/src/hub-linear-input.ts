import { z } from "zod";
export const hubLinearResolveInput = {
  workspaceId: z.string(),
  key: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/),
};
export const hubTicketCommentInput = {
  ticketId: z.string(),
  text: z.string().min(1).max(60000),
};
