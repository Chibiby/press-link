import { z } from "zod";

export const rosterParticipantSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.enum(["M", "F"]),
});

export const rosterCoachSchema = z.object({
  fullName: z.string().trim().min(1, "Coach name is required"),
  gender: z.enum(["M", "F"]),
});

/**
 * Only an actual answer is writable. `undecided` is the state a school starts
 * in and the state an admin resets it to — never something the school submits.
 */
export const paperParticipationSchema = z.enum(["yes", "no"]);

export type RosterParticipantInput = z.infer<typeof rosterParticipantSchema>;
export type RosterCoachInput = z.infer<typeof rosterCoachSchema>;
export type PaperParticipationInput = z.infer<typeof paperParticipationSchema>;
