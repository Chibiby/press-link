import { describe, expect, it } from "vitest";

import {
  draftFromRanks,
  sheetFormSpec,
  toRankPayload,
  validateSheetDraft,
  type RankDraft,
} from "./sheet-form";
import type { ContestUnit } from "./types";

function unit(code: string): ContestUnit {
  return { unitKey: `u-${code}`, code, entryId: `e-${code}`, participantId: `u-${code}` };
}

const FIELD = [unit("0001"), unit("0002"), unit("0003")];

function draft(pairs: Record<string, number | null>): RankDraft {
  return pairs;
}

describe("sheetFormSpec", () => {
  it("offers blank and 1 to the cut in round 1 (N2)", () => {
    const spec = sheetFormSpec(1, 3);
    expect(spec.options).toEqual([1, 2, 3]);
    expect(spec.allowsBlank).toBe(true);
  });

  it("offers 1 to the qualifier count and no blank in round 2 (N5)", () => {
    const spec = sheetFormSpec(2, 4);
    expect(spec.options).toEqual([1, 2, 3, 4]);
    expect(spec.allowsBlank).toBe(false);
  });

  it("says a blank means eliminated, so the judge is not left guessing", () => {
    // The wording is the reason blanks are safe to leave: a judge who reads this
    // as "unanswered" will rank the whole field and defeat the cut.
    expect(sheetFormSpec(1, 10).hint).toContain("eliminated");
  });

  it("yields no options rather than throwing on a nought or broken size", () => {
    // A cut an admin has set to nought, or an event with no qualifiers drawn. The
    // page renders an empty state; it does not crash on a judge.
    expect(sheetFormSpec(1, 0).options).toEqual([]);
    expect(sheetFormSpec(2, -3).options).toEqual([]);
    expect(sheetFormSpec(1, 2.5).options).toEqual([]);
  });
});

describe("validateSheetDraft — round 1", () => {
  const spec = sheetFormSpec(1, 2);

  it("accepts a sheet that ranks the cut and blanks the rest", () => {
    // The whole point of a cut: two ranked, one deliberately blank, and that is a
    // finished sheet rather than an incomplete one.
    const result = validateSheetDraft(
      spec,
      FIELD,
      draft({ "u-0001": 1, "u-0002": 2, "u-0003": null })
    );
    expect(result).toBeNull();
  });

  it("accepts a tie, which is legal and may push the field past the cut (N3)", () => {
    expect(
      validateSheetDraft(spec, FIELD, draft({ "u-0001": 1, "u-0002": 1, "u-0003": null }))
    ).toBeNull();
  });

  it("refuses a rank above the cut, naming the contestant", () => {
    const result = validateSheetDraft(spec, FIELD, draft({ "u-0001": 3, "u-0002": null, "u-0003": null }));
    expect(result).toContain("0001");
    expect(result).toContain("1 to 2");
  });

  it("refuses a rank of nought or a fraction", () => {
    expect(validateSheetDraft(spec, FIELD, draft({ "u-0001": 0 }))).toContain("0001");
    expect(validateSheetDraft(spec, FIELD, draft({ "u-0001": 1.5 }))).toContain("0001");
  });

  it("refuses a wholly blank sheet, which is a judge submitting too early", () => {
    // Distinguished from an ordinary partly-blank sheet on purpose: eliminating
    // the entire field is not what any cut is for.
    const result = validateSheetDraft(
      spec,
      FIELD,
      draft({ "u-0001": null, "u-0002": null, "u-0003": null })
    );
    expect(result).toContain("Rank at least one");
  });

  it("refuses a key for a contestant who is not on this sheet", () => {
    // The field changed under the judge. Refused rather than dropped: dropping it
    // would submit a sheet they never saw.
    const result = validateSheetDraft(spec, FIELD, draft({ "u-0001": 1, "u-9999": 2 }));
    expect(result).toContain("out of date");
  });

  it("explains a missing cut rather than reporting every row as wrong", () => {
    const result = validateSheetDraft(sheetFormSpec(1, 0), FIELD, draft({}));
    expect(result).toContain("no round-2 cut");
  });
});

describe("validateSheetDraft — round 2", () => {
  const spec = sheetFormSpec(2, 3);

  it("accepts every qualifier placed", () => {
    expect(
      validateSheetDraft(spec, FIELD, draft({ "u-0001": 1, "u-0002": 2, "u-0003": 3 }))
    ).toBeNull();
  });

  it("accepts a tie within one judge's own sheet (N5)", () => {
    expect(
      validateSheetDraft(spec, FIELD, draft({ "u-0001": 1, "u-0002": 1, "u-0003": 2 }))
    ).toBeNull();
  });

  it("refuses a blank, naming the qualifier left unplaced", () => {
    const result = validateSheetDraft(spec, FIELD, draft({ "u-0001": 1, "u-0002": 2 }));
    expect(result).toContain("0003");
    expect(result).toContain("no blanks");
  });

  it("explains an empty qualifier set rather than reporting a bad rank", () => {
    const result = validateSheetDraft(sheetFormSpec(2, 0), FIELD, draft({}));
    expect(result).toContain("No qualifiers");
  });

  it("reports an empty field as having nobody to rank", () => {
    expect(validateSheetDraft(spec, [], draft({}))).toContain("no contestants");
  });
});

describe("toRankPayload", () => {
  it("drops blanks rather than sending them as null (N2)", () => {
    // The RPC's contract: a blank is an absent key. Two ways to say eliminated
    // is one way for a client to be rejected for the wrong reason.
    expect(toRankPayload({ a: 1, b: null, c: 3 })).toEqual({ a: 1, c: 3 });
  });

  it("sends an empty object when nothing is ranked, not an empty array", () => {
    expect(toRankPayload({ a: null })).toEqual({});
  });
});

describe("draftFromRanks", () => {
  it("opens on the judge's saved ranks", () => {
    expect(draftFromRanks(FIELD, [{ unitKey: "u-0002", rank: 1 }])).toEqual({
      "u-0001": null,
      "u-0002": 1,
      "u-0003": null,
    });
  });

  it("shows a contestant added since the sheet was last opened as a blank row", () => {
    // Built from the unit set, not from the saved ranks, so a new contestant is a
    // question to answer rather than a row missing from the form.
    const draft = draftFromRanks(FIELD, [{ unitKey: "u-0001", rank: 1 }]);
    expect(Object.keys(draft)).toEqual(["u-0001", "u-0002", "u-0003"]);
  });

  it("ignores a saved rank for a contestant no longer in the event", () => {
    const draft = draftFromRanks(FIELD, [{ unitKey: "u-gone", rank: 1 }]);
    expect(draft).toEqual({ "u-0001": null, "u-0002": null, "u-0003": null });
  });
});
