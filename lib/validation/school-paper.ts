import { z } from "zod";
import type { PaperLevel } from "@/lib/paper/level";

export const paperStaffSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required"),
  title: z.enum(["section_head", "assistant_head"]),
});

/**
 * Spelled out here rather than imported as a value so the schema stays a plain
 * zod module, and pinned to `PaperLevel` with `satisfies` so adding a level in
 * `lib/paper/level.ts` without adding it here is a compile error rather than a
 * silently rejected save.
 */
const PAPER_LEVELS = ["whole", "elementary", "secondary"] as const satisfies readonly PaperLevel[];

export const schoolPaperSchema = z.object({
  language: z.enum(["english", "filipino"]),
  /**
   * Defaulted, not required: every row on file before migration 0016 is a
   * `whole` paper, and so is every save from a non-integrated school, so input
   * that predates levels keeps parsing to exactly what it already meant. The
   * value is only a claim — `saveSchoolPaperAction` checks it against the
   * school's own `is_integrated` before writing.
   */
  level: z.enum(PAPER_LEVELS).default("whole"),
  paperName: z.string().trim().min(1, "School paper name is required"),
  adviserName: z.string().trim().min(1, "Adviser name is required"),
  adviserGender: z.enum(["M", "F"]),
  principalName: z.string().trim().min(1, "Principal name is required"),
  staff: z.array(paperStaffSchema).min(2, "At least 2 section/assistant heads are required"),
});

export type SchoolPaperInput = z.infer<typeof schoolPaperSchema>;
