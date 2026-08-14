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

/**
 * A No has to say why: the reason decides whether the school keeps being asked
 * and whether its School Paper form stays open. Only "other" carries a note,
 * and it is the one case where the note is required.
 */
export const paperAnswerSchema = z
  .object({
    choice: z.enum(["yes", "no"]),
    reason: z
      .enum(["submit_later", "no_paper_yet", "will_not_submit", "other"])
      .nullish(),
    note: z.string().trim().nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.choice === "no" && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Please choose a reason",
      });
    }
    if (value.reason === "other" && !value.note) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Please describe your reason",
      });
    }
  });

export type RosterParticipantInput = z.infer<typeof rosterParticipantSchema>;
export type RosterCoachInput = z.infer<typeof rosterCoachSchema>;
export type PaperParticipationInput = z.infer<typeof paperParticipationSchema>;
export type PaperAnswerInput = z.infer<typeof paperAnswerSchema>;
