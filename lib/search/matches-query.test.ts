import { describe, expect, it } from "vitest";

import {
  foldDiacritics,
  matchesQuery,
  matchesQueryIgnoringDiacritics,
} from "./matches-query";

/**
 * Every accented name in this file is pinned to NFC, because "Niño" written out
 * in a source file can be stored either as four characters or as five and the
 * two look identical in an editor. A test that compared one form against the
 * other would fail for a reason nobody could see.
 */
const NINO = "Niño".normalize("NFC");
const PENA = "Peña".normalize("NFC");
const MUNOZ = "Muñoz".normalize("NFC");
const JOSE = "José".normalize("NFC");

/**
 * The first three cases came across from `app/entry/list-filters.test.ts`
 * unchanged when the predicate moved here — they are the proof that the move was
 * behaviour-neutral, so they are quoted rather than rewritten. The rest were
 * added because this now serves the admin tables too, where the query arrives
 * out of a URL and can be anything at all.
 */
describe("matchesQuery", () => {
  it("treats an empty or blank query as no filter", () => {
    expect(matchesQuery(["Dela Cruz, Ana"], "")).toBe(true);
    expect(matchesQuery(["Dela Cruz, Ana"], "   ")).toBe(true);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(matchesQuery(["Dela Cruz, Ana"], "  cRUz ")).toBe(true);
  });

  it("matches any one of the fields, and reports a miss on all of them", () => {
    expect(matchesQuery(["Editorial Writing", "Dela Cruz, Ana"], "ana")).toBe(true);
    expect(matchesQuery(["Editorial Writing", "Dela Cruz, Ana"], "reyes")).toBe(false);
  });

  it("matches however the letters are cased on either side", () => {
    expect(matchesQuery(["DELA CRUZ, ANA"], "dela cruz")).toBe(true);
    expect(matchesQuery(["dela cruz, ana"], "DELA CRUZ")).toBe(true);
    expect(matchesQuery(["Dela Cruz, Ana"], "DeLa CrUz")).toBe(true);
  });

  it("matches a multi-word query as one run of characters", () => {
    expect(matchesQuery(["Dela Cruz, Ana"], "dela cruz")).toBe(true);
    expect(matchesQuery(["Bagumbayan Elementary School"], "elementary school")).toBe(
      true
    );
  });

  it("does not reorder or bridge the words of a query", () => {
    // A word-set search would match both of these. This one deliberately does
    // not: the words have to appear together, in the order they were typed.
    expect(matchesQuery(["Dela Cruz, Ana"], "cruz ana")).toBe(false);
    expect(matchesQuery(["Dela Cruz, Ana"], "dela ana")).toBe(false);
  });

  it("trims the ends of a query but not its middle", () => {
    expect(matchesQuery(["Dela Cruz, Ana"], "\tdela cruz\n")).toBe(true);
    // Two spaces where the row has one is a miss, not a near-miss: nothing here
    // collapses runs of whitespace, and a filter that quietly did would be
    // guessing at what was meant.
    expect(matchesQuery(["Dela Cruz, Ana"], "dela  cruz")).toBe(false);
  });

  it("finds the number a school reads off its own form", () => {
    expect(matchesQuery(["Katigbak, Ben", "1738"], "1738")).toBe(true);
    expect(matchesQuery(["Katigbak, Ben", "1738"], "173")).toBe(true);
    expect(matchesQuery(["Katigbak, Ben", "1738"], "1739")).toBe(false);
  });

  it("says no to any real query when there are no fields to search", () => {
    expect(matchesQuery([], "cruz")).toBe(false);
  });

  it("still filters nothing when there are no fields and no query", () => {
    // A row with nothing searchable about it must not vanish from an unfiltered
    // list, so the empty query is answered before the fields are ever read.
    expect(matchesQuery([], "")).toBe(true);
    expect(matchesQuery([], "  ")).toBe(true);
  });

  it("skips over empty fields instead of matching them", () => {
    // A missing middle name arrives as "" out of the database. Nothing is a
    // substring of "" except "", and that query never gets this far.
    expect(matchesQuery([""], "cruz")).toBe(false);
    expect(matchesQuery(["", "Dela Cruz, Ana"], "cruz")).toBe(true);
    expect(matchesQuery(["", ""], "a")).toBe(false);
  });

  it("does not match a query longer than the field", () => {
    expect(matchesQuery(["Ana"], "ana dela cruz")).toBe(false);
  });

  it("leaves accents alone, which is why the folding variant exists", () => {
    // Documented behaviour, not an oversight: "nino" does not find "Niño" here.
    // A page that wants it to has to say so — see the suite at the bottom.
    expect(matchesQuery([`${NINO}, Jose`], "nino")).toBe(false);
    expect(matchesQuery(["Nino, Jose"], NINO.toLowerCase())).toBe(false);
    expect(matchesQuery([`${NINO}, Jose`], NINO.toLowerCase())).toBe(true);
  });
});

describe("foldDiacritics", () => {
  it("keeps the letter and drops the mark", () => {
    expect(foldDiacritics(NINO)).toBe("Nino");
    expect(foldDiacritics(PENA)).toBe("Pena");
    expect(foldDiacritics(MUNOZ)).toBe("Munoz");
    expect(foldDiacritics(`${JOSE} Rizal`)).toBe("Jose Rizal");
  });

  it("folds a mark that arrives already separated from its letter", () => {
    // Postgres can hand back either form. Normalising to NFD first means both
    // reduce to the same string, so a paste out of one system still matches a
    // row typed in another.
    const decomposed = NINO.normalize("NFD");

    expect(NINO).toHaveLength(4);
    expect(decomposed).toHaveLength(5);
    expect(foldDiacritics(NINO)).toBe("Nino");
    expect(foldDiacritics(decomposed)).toBe("Nino");
  });

  it("leaves an unaccented name exactly as it was", () => {
    expect(foldDiacritics("Dela Cruz, Ana")).toBe("Dela Cruz, Ana");
    expect(foldDiacritics("")).toBe("");
  });
});

describe("matchesQueryIgnoringDiacritics", () => {
  it("finds an accented name from an unaccented query", () => {
    expect(matchesQueryIgnoringDiacritics([`${NINO}, Jose`], "nino")).toBe(true);
    expect(matchesQueryIgnoringDiacritics([`${PENA}, Maria`], "pena")).toBe(true);
  });

  it("finds an unaccented row from an accented query", () => {
    expect(matchesQueryIgnoringDiacritics(["Nino, Jose"], NINO.toLowerCase())).toBe(
      true
    );
    expect(matchesQueryIgnoringDiacritics(["Pena, Maria"], PENA.toLowerCase())).toBe(
      true
    );
  });

  it("keeps every other rule of the plain predicate", () => {
    expect(matchesQueryIgnoringDiacritics([`${NINO}, Jose`], `  ${NINO.toUpperCase()} `)).toBe(
      true
    );
    expect(matchesQueryIgnoringDiacritics([`${NINO}, Jose`], "")).toBe(true);
    expect(matchesQueryIgnoringDiacritics([`${NINO}, Jose`], "reyes")).toBe(false);
    expect(matchesQueryIgnoringDiacritics([], "nino")).toBe(false);
  });

  it("does not make different letters equal", () => {
    // Folding is not fuzzy matching: it removes marks, and nothing else.
    expect(matchesQueryIgnoringDiacritics([`${NINO}, Jose`], "nine")).toBe(false);
  });
});
