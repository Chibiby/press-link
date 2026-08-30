/**
 * What a judge's ranking sheet offers, and what it will accept back.
 *
 * The two rounds are not the same form (N1, N2, N5). Round 1 offers blank and
 * 1…the size of the field, capped at {@link ROUND1_RANK_LIMIT}; blank is a final
 * answer meaning eliminated. Round 2 offers 1…qualifierCount with no blank,
 * because every qualifier must be placed. Ties are legal in both.
 *
 * Pure, like the rest of `lib/judging`: the page renders what `sheetFormSpec`
 * describes and the server action checks what `validateSheetDraft` says, so the
 * dropdown a judge sees and the payload the action will accept are derived from
 * one description instead of two hand-written ones that can disagree.
 *
 * This is **not** the authorisation boundary and not the last word on validity.
 * `judging_write_sheet` re-checks every rule below server-side (non-negotiable
 * 2). Checking here as well is what lets the page say which row is wrong; the
 * RPC only has to say no.
 *
 * See `docs/superpowers/specs/2026-08-27-judges-portal-two-stage-ranking-design.md`.
 */

import type { ContestUnit, JudgingRound } from "./types";

/** A judge's answer for one unit: a rank, or blank. */
export type RankDraft = Record<string, number | null>;

export interface SheetFormSpec {
  round: JudgingRound;
  /** The ranks the dropdown offers, ascending. Empty when there is nothing to rank. */
  options: number[];
  /**
   * Whether blank is a legal answer.
   *
   * True in round 1 only. A blank there is not an unanswered question, it is an
   * elimination (N2), which is why the sheet can be submitted with most of its
   * rows empty and why round 2 — where every qualifier must be placed — cannot.
   */
  allowsBlank: boolean;
  /** The sentence printed under the heading, so every surface words it the same. */
  hint: string;
}

/**
 * How many places round 1's dropdown will ever offer.
 *
 * Round 1 used to be bounded by the event's round-2 cut: a cut of ten meant a
 * judge could type 1 to 10 and nothing else. That conflated two decisions. The
 * cut is the division's rule about **who advances**, and it is applied to the
 * filed sheet by `round1Qualifiers`; how far down a field a judge is willing to
 * place is the judge's own working. A judge who ranks fifteen under a cut of ten
 * has not made a mistake — they have ranked past the line, and the eleventh
 * onwards simply do not qualify.
 *
 * So the dropdown is bounded by the field instead, and by this ceiling. The
 * ceiling is a usability bound, not a rule of the contest: a select of several
 * hundred rows is unusable on the phone a judge actually holds, and no division
 * event fields anything near fifty contestants. `judging_write_sheet` enforces
 * the same bound server-side (migration 0032), because a maximum the client
 * alone keeps is not a maximum.
 */
export const ROUND1_RANK_LIMIT = 50;

/**
 * The form for one round.
 *
 * `size` is the size of the field in both rounds — every contestant in round 1,
 * the qualifiers in round 2. Round 1 caps it at {@link ROUND1_RANK_LIMIT}; round 2
 * needs no cap of its own, since its field is a subset of round 1's.
 *
 * A size below 1 yields no options rather than throwing. An event with no
 * contestants is a sheet with nothing to rank — which the page renders as an
 * empty state, not as a crash.
 */
export function sheetFormSpec(round: JudgingRound, size: number): SheetFormSpec {
  const field = Number.isInteger(size) && size > 0 ? size : 0;
  const count = round === 1 ? Math.min(field, ROUND1_RANK_LIMIT) : field;
  const options = Array.from({ length: count }, (_, index) => index + 1);

  if (round === 1) {
    return {
      round,
      options,
      allowsBlank: true,
      hint: `Rank as far down the field as you mean to, from 1 to ${count}, and leave everyone else blank. A blank is a final answer — it means eliminated. Two contestants may share a rank.`,
    };
  }

  return {
    round,
    options,
    allowsBlank: false,
    hint: `Give every qualifier a rank from 1 to ${count}. There are no blanks in round 2. Two contestants may share a rank.`,
  };
}

/**
 * What is wrong with this draft, in a sentence a judge can act on, or null when
 * it is submittable.
 *
 * One sentence rather than a list: a judge fixes one row and resubmits, and a
 * wall of errors on a form this small reads as a broken page rather than a
 * correctable mistake. The first fault in code order is reported, so the sentence
 * names the row nearest the top of the sheet.
 */
export function validateSheetDraft(
  spec: SheetFormSpec,
  units: ContestUnit[],
  draft: RankDraft
): string | null {
  const highest = spec.options.at(-1) ?? 0;

  if (units.length === 0) {
    return "This sheet has no contestants to rank.";
  }
  if (highest === 0) {
    return spec.round === 1
      ? "This sheet offers no ranks to give, so there is nothing to submit."
      : "No qualifiers have been drawn for this event yet.";
  }

  const known = new Set(units.map((unit) => unit.unitKey));
  for (const unitKey of Object.keys(draft)) {
    // A key for a unit not on this sheet means the form and the unit set have
    // come apart — an entry withdrawn while the judge was ranking, most likely.
    // Refused rather than dropped: silently discarding it would submit a sheet
    // the judge did not see, and reloading shows them the field as it now is.
    if (!known.has(unitKey)) {
      return "This sheet is out of date — the contestants have changed since it was opened. Reload the page and rank again.";
    }
  }

  for (const unit of units) {
    const rank = draft[unit.unitKey] ?? null;

    if (rank === null) {
      if (spec.allowsBlank) continue;
      return `Contestant ${unit.code} has no rank. Round 2 has no blanks — every qualifier must be placed.`;
    }

    if (!Number.isInteger(rank) || rank < 1 || rank > highest) {
      return `Contestant ${unit.code} has a rank of ${rank}, which is outside 1 to ${highest}.`;
    }
  }

  if (spec.round === 1 && units.every((unit) => (draft[unit.unitKey] ?? null) === null)) {
    // Every row blank is a sheet that eliminates the whole field, which no cut
    // is meant to do. Distinguished from an ordinary partly-blank sheet because
    // it is far more likely to be a judge submitting before ranking than a
    // deliberate verdict.
    return "No contestant has been ranked. Rank at least one before submitting.";
  }

  return null;
}

/**
 * The draft as `judging_write_sheet` wants it: an object keyed by unit key, with
 * blanks absent rather than null.
 *
 * The absence is the point, and it is the RPC's contract, not a convenience: a
 * payload with two ways to say "eliminated" is a payload a client can get wrong
 * in a way that is rejected for the wrong reason.
 */
export function toRankPayload(draft: RankDraft): Record<string, number> {
  const payload: Record<string, number> = {};
  for (const [unitKey, rank] of Object.entries(draft)) {
    if (rank !== null && rank !== undefined) payload[unitKey] = rank;
  }
  return payload;
}

/**
 * The draft a sheet opens on: the judge's saved ranks, with every other unit
 * blank.
 *
 * Built from the unit set rather than from the saved ranks, so a unit added to
 * the event since the sheet was last opened appears as a blank row to be
 * answered instead of silently missing from the form.
 */
export function draftFromRanks(
  units: ContestUnit[],
  saved: { unitKey: string; rank: number }[]
): RankDraft {
  const byUnit = new Map(saved.map((row) => [row.unitKey, row.rank]));
  const draft: RankDraft = {};
  for (const unit of units) draft[unit.unitKey] = byUnit.get(unit.unitKey) ?? null;
  return draft;
}
