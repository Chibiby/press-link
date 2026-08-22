import type { JudgingRound } from "./types";

/**
 * The two rounds, and how they are named on screen.
 *
 * There are exactly two and there will not be a third: round 1 selects who
 * advances, round 2 decides the winners (D4). A `JudgingRound` is therefore a
 * closed union rather than a plain `number`, so a page cannot render "Round 3"
 * by arithmetic and no `switch` over rounds needs a default branch.
 */
export const ROUNDS: JudgingRound[] = [1, 2];

export const ROUND_LABEL: Record<JudgingRound, string> = {
  1: "Round 1",
  2: "Round 2",
};

/**
 * What each round covers, printed under its heading so a judge opening a sheet
 * knows why the list is shorter than they expected.
 */
export const ROUND_SCOPE: Record<JudgingRound, string> = {
  1: "Every contestant in this event.",
  2: "Qualifiers from round 1 only.",
};

/**
 * Narrows a round that arrived from outside the type system.
 *
 * It accepts a string as well as a number on purpose. Every real caller is a
 * route param (`/judge/[eventId]?round=2`) or a form field, and both of those
 * are strings — so a number-only guard would push `Number(...)` to each call
 * site, and the one that forgot would fail closed and silently show round 1.
 * Coercing here means there is one place that knows the wire format.
 *
 * `Number("")` is 0 and `Number(" 1 ")` is 1, which is why the string branch
 * tests the shape before converting: a blank or padded field is a malformed
 * request, not round 1. Booleans, arrays and `null` all coerce to numbers in
 * JavaScript too, so the guard checks the type first rather than trusting
 * `Number()` to reject them — `Number(true)` is 1, and `[1]` coerces to 1 as
 * well.
 */
export function isJudgingRound(value: unknown): value is JudgingRound {
  if (typeof value === "number") return value === 1 || value === 2;
  if (typeof value !== "string") return false;
  return value === "1" || value === "2";
}

/**
 * The round a caller asked for, or null when it cannot be read.
 *
 * Separate from {@link isJudgingRound} because a guard narrows and a parser
 * converts, and the callers want different things: a `switch` wants the guard,
 * a route wants the value. Returning null rather than defaulting to 1 keeps the
 * decision with the page, which is the only place that knows whether a missing
 * round is a redirect or a 404.
 */
export function parseJudgingRound(value: unknown): JudgingRound | null {
  if (!isJudgingRound(value)) return null;
  return (typeof value === "number" ? value : Number(value)) as JudgingRound;
}
