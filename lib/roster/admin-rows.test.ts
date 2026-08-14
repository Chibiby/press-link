import { describe, expect, it } from "vitest";
import { toAdminParticipantRows, type RawAdminParticipant } from "./admin-rows";

const raw = (overrides: Partial<RawAdminParticipant> = {}): RawAdminParticipant => ({
  id: "p1",
  participant_number: 7,
  first_name: "Ana",
  middle_name: null,
  last_name: "Dela Cruz",
  gender: "F",
  schools: {
    id: "s1",
    name: "Bagumbayan ES",
    district_id: "d1",
    paper_participation: "yes",
    paper_locked_at: null,
    paper_count: 2,
    districts: { name: "District I" },
  },
  entry_participants: [{ entry_id: "e1" }],
  ...overrides,
});

describe("toAdminParticipantRows", () => {
  it("pads the number and builds a surname-first name", () => {
    const [row] = toAdminParticipantRows([raw()]);
    expect(row.numberLabel).toBe("0007");
    expect(row.fullName).toBe("Dela Cruz, Ana");
  });

  it("leaves a single-event participant unmarked", () => {
    const [row] = toAdminParticipantRows([raw()]);
    expect(row.isMultiEvent).toBe(false);
    expect(row.displayNumber).toBe("0007");
    expect(row.eventCount).toBe(1);
  });

  it("asterisks a participant in more than one event", () => {
    const [row] = toAdminParticipantRows([
      raw({ entry_participants: [{ entry_id: "e1" }, { entry_id: "e2" }] }),
    ]);
    expect(row.isMultiEvent).toBe(true);
    expect(row.displayNumber).toBe("*0007");
    expect(row.eventCount).toBe(2);
  });

  it("keeps a participant with no entries at zero", () => {
    const [row] = toAdminParticipantRows([raw({ entry_participants: [] })]);
    expect(row.eventCount).toBe(0);
    expect(row.isMultiEvent).toBe(false);
  });

  it("includes the middle name when present", () => {
    const [row] = toAdminParticipantRows([raw({ middle_name: "Mercado" })]);
    expect(row.fullName).toBe("Dela Cruz, Ana Mercado");
  });

  it("sorts by participant number", () => {
    const rows = toAdminParticipantRows([
      raw({ id: "b", participant_number: 12 }),
      raw({ id: "a", participant_number: 3 }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("labels a school that only saved its paper information", () => {
    const [row] = toAdminParticipantRows([
      raw({
        schools: {
          id: "s1",
          name: "Bagumbayan ES",
          district_id: "d1",
          paper_participation: "no",
          paper_locked_at: null,
          paper_count: 1,
          districts: { name: "District I" },
        },
      }),
    ]);
    expect(row.paperStatus).toBe("saved");
    expect(row.paperLocked).toBe(false);
  });

  it("labels a locked contest submission", () => {
    const [row] = toAdminParticipantRows([
      raw({
        schools: {
          id: "s1",
          name: "Bagumbayan ES",
          district_id: "d1",
          paper_participation: "yes",
          paper_locked_at: "2026-08-14T02:00:00.000Z",
          paper_count: 2,
          districts: { name: "District I" },
        },
      }),
    ]);
    expect(row.paperStatus).toBe("submitted");
    expect(row.paperLocked).toBe(true);
  });

  it("falls back to incomplete when a participant has no school", () => {
    const [row] = toAdminParticipantRows([raw({ schools: null })]);
    expect(row.paperStatus).toBe("incomplete");
    expect(row.paperLocked).toBe(false);
  });
});
