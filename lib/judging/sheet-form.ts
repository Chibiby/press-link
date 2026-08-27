/**
 * What a judge's ranking sheet offers, and what it will accept back.
 *
 * The two rounds are not the same form (N1, N2, N5). Round 1 offers blank and
 * 1…cut, and blank is a final answer meaning eliminated. Round 2 offers
 * 1…qualifierCount with no blank, because every qualifier must be placed. Ties
 * are legal in both.
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
 * The form for one round.
 *
 * `size` is the cut in round 1 and the qualifier count in round 2 — the two
 * numbers that bound the dropdown. They are different facts about different
 * fields, so the caller names which one it is passing by calling with the round
 * rather than by passing both and hoping the right one is read.
 *
 * A size below 1 yields no options rather than throwing. An event with no
 * contestants, or a cut an admin has set to nought, is a sheet with nothing to
 * rank — which the page renders as an empty state, not as a crash.
 */
export function sheetFormSpec(round: JudgingRound, size: number): SheetFormSpec {
  const count = Number.isInteger(size) && size > 0 ? size : 0;
  const options = Array.from({ length: count }, (_, index) => index + 1);

  if (round === 1) {
    return {
      round,
      options,
      allowsBlank: true,
      hint: `Rank the top ${count} and leave everyone else blank. A blank is a final answer — it means eliminated. Two contestants may share a rank.`,
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
      ? "This event has no round-2 cut set, so there is no rank to give. Ask an administrator to set one."
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
