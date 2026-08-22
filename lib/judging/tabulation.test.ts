import { describe, expect, it } from "vitest";

import {
  attachIdentities,
  formatCoaches,
  schoolPaperForEvent,
  TABULATION_COLUMNS,
  tabulationCell,
  tabulationSummary,
  UNIDENTIFIED,
  type SchoolPaperRow,
} from "./tabulation";
import type { StandingRow, TabulationRow, UnitIdentity } from "./types";

const ENGLISH_WHOLE: SchoolPaperRow = {
  language: "english",
  level: "whole",
  paper_name: "The Torch",
};
const FILIPINO_WHOLE: SchoolPaperRow = {
  language: "filipino",
  level: "whole",
  paper_name: "Ang Sulo",
};
const ENGLISH_ELEM: SchoolPaperRow = {
  language: "english",
  level: "elementary",
  paper_name: "The Spark",
};
const ENGLISH_SEC: SchoolPaperRow = {
  language: "english",
  level: "secondary",
  paper_name: "The Beacon",
};
const FILIPINO_SEC: SchoolPaperRow = {
  language: "filipino",
  level: "secondary",
  paper_name: "Ang Parola",
};

describe("schoolPaperForEvent — an ordinary school", () => {
  it("prints the whole-school paper in the event's language", () => {
    expect(
      schoolPaperForEvent([ENGLISH_WHOLE, FILIPINO_WHOLE], { level: "secondary", language: "filipino" }, false)
    ).toBe("Ang Sulo");
  });

  it("does not care about the event's level", () => {
    // A non-integrated school files one paper for the whole school, so the same
    // name appears against an elementary and a secondary event.
    for (const level of ["elementary", "secondary"] as const) {
      expect(schoolPaperForEvent([ENGLISH_WHOLE], { level, language: "english" }, false)).toBe(
        "The Torch"
      );
    }
  });

  it("falls back to the other language", () => {
    // A school that publishes only in Filipino still enters English events.
    // Printing nothing would suggest the school has no paper at all.
    expect(
      schoolPaperForEvent([FILIPINO_WHOLE], { level: "secondary", language: "english" }, false)
    ).toBe("Ang Sulo");
  });

  it("ignores a levelled row, which cannot belong to this school", () => {
    expect(
      schoolPaperForEvent([ENGLISH_SEC], { level: "secondary", language: "english" }, false)
    ).toBeNull();
  });
});

describe("schoolPaperForEvent — an integrated school", () => {
  const papers = [ENGLISH_ELEM, ENGLISH_SEC, FILIPINO_SEC];

  it("credits an elementary event to the elementary paper", () => {
    expect(schoolPaperForEvent(papers, { level: "elementary", language: "english" }, true)).toBe(
      "The Spark"
    );
  });

  it("credits a secondary event to the secondary paper", () => {
    expect(schoolPaperForEvent(papers, { level: "secondary", language: "english" }, true)).toBe(
      "The Beacon"
    );
  });

  it("prefers the event's language within the level", () => {
    expect(schoolPaperForEvent(papers, { level: "secondary", language: "filipino" }, true)).toBe(
      "Ang Parola"
    );
  });

  it("falls back across language but never across level", () => {
    // The whole point of the split: an elementary contestant must not be credited
    // to the secondary paper, even when it is the only one on file.
    expect(
      schoolPaperForEvent([ENGLISH_SEC], { level: "elementary", language: "english" }, true)
    ).toBeNull();
    expect(
      schoolPaperForEvent([FILIPINO_SEC], { level: "secondary", language: "english" }, true)
    ).toBe("Ang Parola");
  });

  it("ignores a retired whole-school row", () => {
    // 0017 retired integrated schools' pre-split papers for re-filing. Printing
    // one would credit a contestant to a publication that no longer exists.
    expect(
      schoolPaperForEvent([ENGLISH_WHOLE], { level: "secondary", language: "english" }, true)
    ).toBeNull();
  });
});

describe("schoolPaperForEvent — nothing usable on file", () => {
  it("returns null for no papers", () => {
    expect(schoolPaperForEvent([], { level: "secondary", language: "english" }, false)).toBeNull();
  });

  it("treats a null name as nothing on file", () => {
    expect(
      schoolPaperForEvent(
        [{ language: "english", level: "whole", paper_name: null }],
        { level: "secondary", language: "english" },
        false
      )
    ).toBeNull();
  });

  it("treats a blank name as nothing on file", () => {
    // An empty cell in the source workbook must not render as a paper whose name
    // is a space.
    expect(
      schoolPaperForEvent(
        [{ language: "english", level: "whole", paper_name: "   " }],
        { level: "secondary", language: "english" },
        false
      )
    ).toBeNull();
  });

  it("trims the name it does return", () => {
    expect(
      schoolPaperForEvent(
        [{ language: "english", level: "whole", paper_name: "  The Torch  " }],
        { level: "secondary", language: "english" },
        false
      )
    ).toBe("The Torch");
  });
});

function standing(code: string, over: Partial<StandingRow> = {}): StandingRow {
  return {
    unitKey: `u-${code}`,
    code,
    entryId: `e-${code}`,
    participantId: `p-${code}`,
    qualified: true,
    round1Points: 3,
    round1Rank: 1,
    round2Points: 2,
    round2Rank: 1,
    totalRank: 2,
    finalRank: 1,
    ...over,
  };
}

function identity(code: string, over: Partial<UnitIdentity> = {}): UnitIdentity {
  return {
    unitKey: `u-${code}`,
    name: "Dela Cruz, Juan P.",
    coaches: ["Reyes, Maria"],
    schoolPaper: "The Torch",
    schoolName: "Bogo Central ES",
    districtName: "Bogo City",
    ...over,
  };
}

describe("attachIdentities", () => {
  it("joins a standing to its identity", () => {
    const { rows, unidentified } = attachIdentities([standing("0001")], [identity("0001")]);
    expect(unidentified).toEqual([]);
    expect(rows[0]).toMatchObject({
      code: "0001",
      name: "Dela Cruz, Juan P.",
      coaches: ["Reyes, Maria"],
      schoolName: "Bogo Central ES",
      districtName: "Bogo City",
      finalRank: 1,
    });
  });

  it("keeps the standing's own fields", () => {
    const { rows } = attachIdentities([standing("0001")], [identity("0001")]);
    expect(rows[0].unitKey).toBe("u-0001");
    expect(rows[0].round1Rank).toBe(1);
  });

  it("keeps an unmatched row rather than dropping it", () => {
    // Its ranks are correct; only the join failed. A dropped row would silently
    // shorten the sheet and look exactly like a contestant who never entered.
    const { rows, unidentified } = attachIdentities([standing("0001"), standing("0002")], [
      identity("0001"),
    ]);
    expect(rows).toHaveLength(2);
    expect(unidentified).toEqual(["0002"]);
  });

  it("marks an unmatched row visibly rather than blanking it", () => {
    const { rows } = attachIdentities([standing("0002")], []);
    expect(rows[0].schoolName).toBe(UNIDENTIFIED);
    expect(rows[0].districtName).toBe(UNIDENTIFIED);
    expect(rows[0].name).toBeNull();
    expect(rows[0].coaches).toEqual([]);
  });

  it("preserves the order it was given", () => {
    const { rows } = attachIdentities(
      [standing("0003"), standing("0001"), standing("0002")],
      [identity("0001"), identity("0002"), identity("0003")]
    );
    expect(rows.map((r) => r.code)).toEqual(["0003", "0001", "0002"]);
  });

  it("handles a group unit, which has no one name", () => {
    const { rows } = attachIdentities(
      [standing("0011", { participantId: null, unitKey: "e-0011" })],
      [identity("0011", { unitKey: "e-0011", name: null, coaches: ["Reyes, Maria", "Cruz, Ana"] })]
    );
    expect(rows[0].name).toBeNull();
    expect(rows[0].coaches).toHaveLength(2);
  });

  it("returns nothing for no standings", () => {
    expect(attachIdentities([], [identity("0001")])).toEqual({ rows: [], unidentified: [] });
  });
});

describe("TABULATION_COLUMNS", () => {
  it("is exactly the sheet the division asked for, in order", () => {
    // Each round's points sit immediately after its rank, per D4: "Each round
    // also shows its points (the judges' ranks added) beside the round rank, so
    // a tabulator can see how a placement was produced without reading the
    // database." Section 0 of the contract summarises the sheet without them;
    // this order follows the decision record, which is the specific instruction.
    expect(TABULATION_COLUMNS.map((c) => c.key)).toEqual([
      "code",
      "name",
      "coach",
      "schoolPaper",
      "schoolName",
      "districtName",
      "round1Rank",
      "round1Points",
      "round2Rank",
      "round2Points",
      "totalRank",
      "finalRank",
    ]);
  });

  it("prints the points that produced each round's rank", () => {
    // The point of the D4 requirement: a rank with no points beside it is an
    // answer with the working rubbed out, and a tabulator checking a disputed
    // placement would have to read the database to verify it.
    const keys = TABULATION_COLUMNS.map((c) => c.key);
    expect(keys.indexOf("round1Points")).toBe(keys.indexOf("round1Rank") + 1);
    expect(keys.indexOf("round2Points")).toBe(keys.indexOf("round2Rank") + 1);
  });

  it("labels every column", () => {
    for (const column of TABULATION_COLUMNS) {
      expect(column.label.length).toBeGreaterThan(0);
    }
  });

  it("attaches the caveat to total rank and to nothing else", () => {
    // Non-negotiable 6. Carried on the column definition so a surface cannot
    // render the column without having the caveat to hand.
    const noted = TABULATION_COLUMNS.filter((c) => c.note);
    expect(noted.map((c) => c.key)).toEqual(["totalRank"]);
    expect(noted[0].note?.toLowerCase()).toContain("informational");
  });

  it("puts final rank last, where the eye lands", () => {
    expect(TABULATION_COLUMNS.at(-1)?.key).toBe("finalRank");
  });
});

describe("tabulationCell", () => {
  const row: TabulationRow = {
    ...standing("0042"),
    name: "Dela Cruz, Juan P.",
    coaches: ["Reyes, Maria", "Cruz, Ana"],
    schoolPaper: "The Torch",
    schoolName: "Bogo Central ES",
    districtName: "Bogo City",
  };

  it("prints text columns as they are", () => {
    expect(tabulationCell(row, "code")).toBe("0042");
    expect(tabulationCell(row, "schoolName")).toBe("Bogo Central ES");
  });

  it("joins coaches with semicolons, because a name may contain a comma", () => {
    // Surname-first names are full of commas. Comma-separating the list would make
    // "Reyes, Maria; Cruz, Ana" unparseable in a spreadsheet.
    expect(tabulationCell(row, "coach")).toBe("Reyes, Maria; Cruz, Ana");
  });

  it("prints ranks as numbers", () => {
    expect(tabulationCell(row, "finalRank")).toBe("1");
  });

  it("prints an absent rank as an em dash, not 0 and not a blank", () => {
    // 0 would sort as a winning place. A blank is indistinguishable from a cell
    // the export failed to write.
    const open = { ...row, round2Rank: null, totalRank: null, finalRank: null };
    expect(tabulationCell(open, "round2Rank")).toBe("—");
    expect(tabulationCell(open, "totalRank")).toBe("—");
    expect(tabulationCell(open, "finalRank")).toBe("—");
  });

  it("prints an absent name and paper as an em dash", () => {
    const anonymous = { ...row, name: null, schoolPaper: null };
    expect(tabulationCell(anonymous, "name")).toBe("—");
    expect(tabulationCell(anonymous, "schoolPaper")).toBe("—");
  });

  it("renders every declared column without throwing", () => {
    for (const column of TABULATION_COLUMNS) {
      expect(typeof tabulationCell(row, column.key)).toBe("string");
    }
  });
});

describe("formatCoaches", () => {
  it("joins with semicolons", () => {
    expect(formatCoaches(["A", "B"])).toBe("A; B");
  });

  it("is empty for no coaches", () => {
    expect(formatCoaches([])).toBe("");
  });
});

describe("tabulationSummary", () => {
  it("counts contestants, qualifiers, placed rows and faults", () => {
    const { rows } = attachIdentities(
      [
        standing("0001", { qualified: true, finalRank: 1 }),
        standing("0002", { qualified: true, finalRank: 2 }),
        standing("0003", { qualified: false, finalRank: 3, round2Rank: null, totalRank: null }),
        standing("0004", { qualified: false, finalRank: null, round2Rank: null, totalRank: null }),
      ],
      [identity("0001"), identity("0002"), identity("0003")]
    );
    expect(tabulationSummary(rows)).toEqual({
      contestants: 4,
      qualifiers: 2,
      placed: 3,
      unidentified: 1,
    });
  });

  it("is all zeroes for an empty event", () => {
    expect(tabulationSummary([])).toEqual({
      contestants: 0,
      qualifiers: 0,
      placed: 0,
      unidentified: 0,
    });
  });
});
