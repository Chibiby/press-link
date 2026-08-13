import { z } from "zod";

export const participantSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().min(1, "Last name is required"),
  gender: z.enum(["M", "F"]),
});

export const coachSchema = z.object({
  fullName: z.string().trim().min(1, "Coach name is required"),
  gender: z.enum(["M", "F"]),
});

export const entrySchema = z
  .object({
    eventId: z.string().uuid(),
    category: z.enum(["individual", "group"]),
    participants: z.array(participantSchema),
    coaches: z.array(coachSchema).min(1, "At least 1 coach is required").max(2, "At most 2 coaches are allowed"),
  })
  .superRefine((data, ctx) => {
    const min = data.category === "individual" ? 1 : 2;
    const max = data.category === "individual" ? 1 : Infinity;
    if (data.participants.length < min) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message:
          data.category === "individual"
            ? "Individual events require exactly 1 participant"
            : "Group events require at least 2 participants",
      });
    }
    if (data.participants.length > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: "Individual events require exactly 1 participant",
      });
    }
  });

export type EntryInput = z.infer<typeof entrySchema>;
