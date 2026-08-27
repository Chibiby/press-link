import { describe, expect, it } from "vitest";

import { EMPTY_SEAT_CHOICE, seatPicker, type SeatableEvent } from "./seat-picker";

/**
 * Two contests. Editorial Writing runs in both languages and both levels; News
 * Writing runs in English only, which is what makes the language question able to
 * narrow to nothing.
 */
const EVENTS: SeatableEvent[] = [
  { eventId: "ed-sec-fil", typeNameEn: "Editorial Writing", level: "secondary", language: "filipino", seats: [] },
  { eventId: "ed-sec-eng", typeNameEn: "Editorial Writing", level: "secondary", language: "english", seats: [] },
  { eventId: "ed-elem-eng", typeNameEn: "Editorial Writing", level: "elementary", language: "english", seats: [] },
  { eventId: "nw-sec-eng", typeNameEn: "News Writing", level: "secondary", language: "english", seats: [] },
];

const JUDGE = "judge-1";

describe("seatPicker", () => {
  it("lists each contest once, alphabetically, however many events it has", () => {
    const picker = seatPicker(EVENTS, EMPTY_SEAT_CHOICE, JUDGE);
    expect(picker.contests).toEqual(["Editorial Writing", "News Writing"]);
  });

  it("offers no language until a contest is chosen", () => {
    expect(seatPicker(EVENTS, EMPTY_SEAT_CHOICE, JUDGE).languages).toEqual([]);
  });

  it("offers only the languages the chosen contest is actually run in", () => {
    const both = seatPicker(EVENTS, { ...EMPTY_SEAT_CHOICE, contest: "Editorial Writing" }, JUDGE);
    expect(both.languages).toEqual(["english", "filipino"]);

    const one = seatPicker(EVENTS, { ...EMPTY_SEAT_CHOICE, contest: "News Writing" }, JUDGE);
    expect(one.languages).toEqual(["english"]);
  });

  it("narrows the levels to the chosen contest and language together", () => {
    // Editorial Writing has both levels in English but only secondary in Filipino,
    // so the level list cannot be computed from the contest alone.
    expect(
      seatPicker(EVENTS, { contest: "Editorial Writing", language: "english", level: "" }, JUDGE)
        .levels
    ).toEqual(["elementary", "secondary"]);
    expect(
      seatPicker(EVENTS, { contest: "Editorial Writing", language: "filipino", level: "" }, JUDGE)
        .levels
    ).toEqual(["secondary"]);
  });

  it("resolves all three answers to one event", () => {
    const picker = seatPicker(
      EVENTS,
      { contest: "Editorial Writing", language: "filipino", level: "secondary" },
      JUDGE
    );
    expect(picker.event?.eventId).toBe("ed-sec-fil");
  });

  it("resolves to nothing when an answer left over from a previous choice no longer fits", () => {
    // Filipino was valid for Editorial Writing and is not for News Writing. The
    // stale answer must narrow to nothing rather than quietly resolve to the
    // English event beside it.
    const picker = seatPicker(
      EVENTS,
      { contest: "News Writing", language: "filipino", level: "secondary" },
      JUDGE
    );
    expect(picker.event).toBeNull();
    expect(picker.languages).not.toContain("filipino");
    expect(picker.seats).toEqual([]);
  });

  it("offers all four seats in round order, naming whoever is on one", () => {
    const seated: SeatableEvent[] = [
      { ...EVENTS[0], seats: [{ seat: 2, judgeId: "other", judgeName: "Reyes, A." }] },
    ];
    const picker = seatPicker(
      seated,
      { contest: "Editorial Writing", language: "filipino", level: "secondary" },
      JUDGE
    );

    expect(picker.seats.map((seat) => seat.seat)).toEqual([1, 2, 3, 4]);
    expect(picker.seats.map((seat) => seat.round)).toEqual([1, 2, 2, 2]);
    expect(picker.seats[1].occupiedBy).toBe("Reyes, A.");
    expect(picker.seats[0].occupiedBy).toBeNull();
  });

  it("blocks the event outright when this judge already sits on it", () => {
    // 0018's unique (judge_id, event_id): offering their other seats would be
    // offering a move the database refuses.
    const seated: SeatableEvent[] = [
      { ...EVENTS[0], seats: [{ seat: 1, judgeId: JUDGE, judgeName: "Dela Cruz, M." }] },
    ];
    const picker = seatPicker(
      seated,
      { contest: "Editorial Writing", language: "filipino", level: "secondary" },
      JUDGE
    );

    expect(picker.event?.eventId).toBe("ed-sec-fil");
    expect(picker.blocked).toContain("seat 1");
  });

  it("does not block on somebody else's seat", () => {
    const seated: SeatableEvent[] = [
      { ...EVENTS[0], seats: [{ seat: 1, judgeId: "other", judgeName: "Reyes, A." }] },
    ];
    const picker = seatPicker(
      seated,
      { contest: "Editorial Writing", language: "filipino", level: "secondary" },
      JUDGE
    );
    expect(picker.blocked).toBeNull();
  });
});
