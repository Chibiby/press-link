import { z } from "zod";

/**
 * A coach on the entry, and the contestant they are for.
 *
 * Null means unpaired, which an individual entry no longer sends — its coaches
 * come one per contestant. It stays in the shape for group entries, whose
 * coaches belong to the whole team.
 */
const entryCoachSchema = z.object({
  coachId: z.string().uuid(),
  participantId: z.string().uuid().nullable(),
});

/**
 * Shape only. Count rules (per-event minimums, coach limits, participation
 * caps) depend on database state, so they live in `lib/roster/limits.ts` and
 * `saveEntryAction` rather than here. Whether each coach is paired with a
 * contestant on this very entry is checked there too.
 */
export const entrySchema = z.object({
  eventId: z.string().uuid(),
  participantIds: z.array(z.string().uuid()).min(1, "Pick at least 1 participant"),
  coaches: z.array(entryCoachSchema).min(1, "Pick at least 1 coach"),
});

export type EntryInput = z.infer<typeof entrySchema>;
