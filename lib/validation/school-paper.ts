import { z } from "zod";

export const paperStaffSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required"),
  title: z.enum(["section_head", "assistant_head"]),
});

export const schoolPaperSchema = z.object({
  language: z.enum(["english", "filipino"]),
  paperName: z.string().trim().min(1, "School paper name is required"),
  adviserName: z.string().trim().min(1, "Adviser name is required"),
  adviserGender: z.enum(["M", "F"]),
  principalName: z.string().trim().min(1, "Principal name is required"),
  staff: z.array(paperStaffSchema).min(2, "At least 2 section/assistant heads are required"),
});

export type SchoolPaperInput = z.infer<typeof schoolPaperSchema>;
