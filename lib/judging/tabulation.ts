import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import { levelBelongsTo, type PaperLevel } from "@/lib/paper/level";

import type { StandingRow, TabulationRow, UnitIdentity } from "./types";

/**
 * Printed where a name, school or district could not be resolved.
 *
 * Deliberately not "—" and not a blank. A dash reads as "this contestant has no
 * coach", which is a fact; this is "we could not read who they are", which is a
 * fault, and the two must not look the same on a results sheet.
 */
export const UNIDENTIFIED = "Unidentified";

/** A `school_papers` row, as much of it as tabulation needs. */
export interface SchoolPaperRow {
  language: EventLanguage;
  level: PaperLevel;
  paper_name: string | null;
}

/**
 * The school paper to print beside a contestant in a given event.
 *
 * Two rules, and the second is the one that surprises people.
 *
 * **Level.** An integrated school files one paper per level, so the paper to
 * print is the one matching the *event's* level — a secondary contestant is
 * credited to the secondary paper. Every other school files a single `whole`
 * paper regardless of the event. This is the same pairing `levelBelongsTo`
 * enforces, so a row that contradicts its school (an integrated school's retired
 * pre-0017 `whole` row, say) is ignored rather than printed.
 *
 * **Language.** The event's language is preferred, and the other language is
 * accepted as a fallback. A school that publishes only in Filipino still enters
 * English events, and printing nothing there would suggest the school has no
 * paper at all. The paper is the publication the contestant represents; it is not
 * a claim about what language the piece was written in.
 *
 * Returns null when there is genuinely nothing on file, which the page renders as
 * a missing paper rather than as an empty string.
 */
export function schoolPaperForEvent(
  papers: SchoolPaperRow[],
  event: { level: EventLevel; language: EventLanguage },
  isIntegrated: boolean
): string | null {
  const wanted: PaperLevel = isIntegrated ? event.level : "whole";

  const candidates = papers.filter(
    (paper) =>
      paper.level === wanted &&
      // Belt and braces with the level match above: a row whose level does not
      // belong to this kind of school is stale, and `wanted` already excludes it.
      // Kept explicit so the intent survives a future third level.
      levelBelongsTo(paper.level, isIntegrated) &&
      paper.paper_name !== null &&
      paper.paper_name.trim().length > 0
  );

  const preferred =
    candidates.find((paper) => paper.language === event.language) ?? candidates[0] ?? null;

  return preferred?.paper_name?.trim() ?? null;
}

/**
 * Joins each standing to the identity behind its code.
 *
 * This is the only place the anonymous side and the identified side meet, and it
 * runs on the tabulators' surfaces only. Nothing a judge can reach calls it
 * (non-negotiable 1).
 *
 * A standing with no matching identity is **kept, marked, and reported** — not
 * dropped and not thrown. Its ranks are correct; it is only the join that failed.
 * Dropping it would silently shorten a results sheet and renumber nothing, so a
 * missing contestant would look exactly like a contestant who never entered.
 */
export function attachIdentities(
  rows: StandingRow[],
  identities: UnitIdentity[]
): { rows: TabulationRow[]; unidentified: string[] } {
  const byKey = new Map(identities.map((identity) => [identity.unitKey, identity]));
  const unidentified: string[] = [];

  const joined = rows.map((row) => {
    const identity = byKey.get(row.unitKey);
    if (!identity) {
      unidentified.push(row.code);
      return {
        ...row,
        name: null,
        coaches: [],
        schoolPaper: null,
        schoolName: UNIDENTIFIED,
        districtName: UNIDENTIFIED,
      };
    }
    const { unitKey: _unitKey, ...rest } = identity;
    return { ...row, ...rest };
  });

  return { rows: joined, unidentified };
}

export interface TabulationColumn {
  key: keyof TabulationRow | "coach";
  label: string;
  /** Set only where the column needs a caveat printed with it. */
  note?: string;
  numeric?: boolean;
}

/**
 * The tabulators' sheet, in the order the division asked for it.
 *
 * One list, consumed by both the on-screen table and the workbook export, so the
 * spreadsheet a tabulator downloads cannot have different columns in a different
 * order from the page they downloaded it from.
 *
 * ## Why the points columns are gone
 *
 * Each round's points used to sit beside its rank, on the 2026-08-21 contract's
 * reasoning: "so a tabulator can see how a placement was produced without reading
 * the database". The division withdrew that on 2026-09-01. The contest is decided
 * by ranking — what a judge typed, and where the sum of those placements puts a
 * contestant — and a sheet that printed the sums beside the ranks invited a reader
 * to compare two numbers where only one of them settles anything. Six columns of
 * arithmetic on a page a tabulator reads across is a cost paid every time the sheet
 * is used, against a check that is made rarely and can still be made: the points
 * are in `judge_ranks` and on the panel board, which is where the working belongs.
 *
 * `finalPoints` is still computed and still decides `finalRank` (N4). Dropping the
 * column removes it from the page and the workbook, not from the arithmetic.
 *
 * No column carries a note. The `note` field stays on the type because a future
 * column may need one, and because dropping it would make the tabulation test that
 * asserts no column is annotated impossible to write.
 */
export const TABULATION_COLUMNS: TabulationColumn[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "coach", label: "Coach" },
  { key: "schoolPaper", label: "School paper" },
  { key: "schoolName", label: "School" },
  { key: "districtName", label: "District" },
  { key: "round1Rank", label: "Rank R1", numeric: true },
  { key: "round2Rank", label: "Rank R2", numeric: true },
  { key: "finalRank", label: "Final rank", numeric: true },
];

/** Coaches as one cell. Semicolons, because a coach's name may contain a comma. */
export function formatCoaches(coaches: string[]): string {
  return coaches.join("; ");
}

/**
 * One cell of the tabulators' sheet as text.
 *
 * Shared by the table and the export so a blank never means two different things
 * in the two places. An absent rank renders as an em dash rather than 0 or an
 * empty string: 0 would sort as a winning place, and a blank would be
 * indistinguishable from a cell the export failed to write.
 */
export function tabulationCell(row: TabulationRow, key: TabulationColumn["key"]): string {
  if (key === "coach") return formatCoaches(row.coaches);

  const value = row[key];
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join("; ");
  return String(value);
}

/**
 * A one-line summary of an event's sheet for the index page.
 *
 * Counts qualifiers and placed rows off the same array the table renders, rather
 * than issuing a second query, so the index and the detail page cannot disagree.
 */
export function tabulationSummary(rows: TabulationRow[]): {
  contestants: number;
  ranked: number;
  qualifiers: number;
  placed: number;
  unidentified: number;
} {
  return {
    contestants: rows.length,
    // Everyone the round 1 judge placed, which since 0032 is its own figure and not
    // a synonym for the qualifiers. A judge ranks as far down the field as they mean
    // to and the cut decides who advances, so a sheet of twenty under a cut of
    // fifteen is twenty ranked and fifteen through — and a page that printed only
    // the second would report an administrative setting as though it were the
    // judging. It is also exactly what the exported workbook lists.
    ranked: rows.filter((row) => row.round1Rank !== null).length,
    qualifiers: rows.filter((row) => row.qualified).length,
    placed: rows.filter((row) => row.finalRank !== null).length,
    unidentified: rows.filter((row) => row.schoolName === UNIDENTIFIED).length,
  };
}
