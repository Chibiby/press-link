import { z } from "zod";

/**
 * Shape only. Count rules (per-event minimums, coach limits, participation
 * caps) depend on database state, so they live in `lib/roster/limits.ts` and
 * `saveEntryAction` rather than here.
 */
export const entrySchema = z.object({
  eventId: z.string().uuid(),
  participantIds: z.array(z.string().uuid()).min(1, "Pick at least 1 participant"),
  coachIds: z.array(z.string().uuid()).min(1, "Pick at least 1 coach"),
});

export type EntryInput = z.infer<typeof entrySchema>;
