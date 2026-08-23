import { describe, expect, it } from "vitest";

import { describeSession, groupActivitySessions, type SessionEvent } from "./activity-sessions";
import type { ActivityItem } from "./activity";

const SCHOOL = "Bagong Silang ES";

/** Held still on purpose: every open-vs-closed assertion below is a function of it. */
const NOW = new Date("2026-08-23T06:00:00+00:00");

function event(partial: Partial<SessionEvent> & Pick<SessionEvent, "kind">): SessionEvent {
  return {
    id: partial.id ?? `${partial.kind}-1`,
    // `in` rather than `??`, so a test can ask for the null-session case.
    sessionId: "sessionId" in partial ? partial.sessionId ?? null : "s1",
    at: partial.at ?? "2026-08-23T05:00:00+00:00",
    schoolName: partial.schoolName ?? SCHOOL,
    kind: partial.kind,
    label: partial.label ?? null,
  };
}

function group(events: SessionEvent[], overrides: Partial<Parameters<typeof groupActivitySessions>[0]> = {}) {
  return groupActivitySessions({
    events,
    capped: new Set(),
    legacy: [],
    sessionsProbed: 1,
    limit: 20,
    now: NOW,
    ...overrides,
  });
}

function legacyItem(id: string, at: string): ActivityItem {
  return { id, kind: "entry", at, title: id, meta: null, href: null };
}

describe("describeSession", () => {
  it("writes the sentence the requirement asked for", () => {
    expect(
      describeSession(
        { "participant-added": 5, "coach-added": 5, "entry-submitted": 6 },
        SCHOOL,
        false
      )
    ).toBe("Bagong Silang ES added 5 learners, 5 coaches and entry for 6 events");
  });

  it("uses the singular for one of anything", () => {
    expect(
      describeSession(
        { "participant-added": 1, "coach-added": 1, "entry-submitted": 1 },
        SCHOOL,
        false
      )
    ).toBe("Bagong Silang ES added 1 learner, 1 coach and entry for 1 event");
  });

  it("omits a zero category rather than saying 0 coaches", () => {
    expect(describeSession({ "participant-added": 5, "coach-added": 0 }, SCHOOL, false)).toBe(
      "Bagong Silang ES added 5 learners"
    );
    // An absent key and an explicit zero must read identically.
    expect(describeSession({ "participant-added": 5 }, SCHOOL, false)).toBe(
      "Bagong Silang ES added 5 learners"
    );
  });

  it("phrases deletions as their own predicate, and entries as withdrawals", () => {
    expect(
      describeSession({ "participant-removed": 2, "coach-removed": 1 }, SCHOOL, false)
    ).toBe("Bagong Silang ES removed 2 learners and 1 coach");
    expect(describeSession({ "entry-withdrawn": 1 }, SCHOOL, false)).toBe(
      "Bagong Silang ES withdrew 1 entry"
    );
    expect(
      describeSession({ "participant-added": 1, "participant-removed": 1 }, SCHOOL, false)
    ).toBe("Bagong Silang ES added 1 learner and removed 1 learner");
  });

  it("says what a school did to its paper and its submissions", () => {
    expect(
      describeSession(
        { "paper-updated": 3, "paper-answered": 1, "submission-locked": 1 },
        SCHOOL,
        false
      )
    ).toBe(
      "Bagong Silang ES updated its school paper, answered the school paper question and locked its submissions"
    );
  });

  it("puts a comma before the last predicate once a predicate holds its own and", () => {
    // Without it, "5 learners, 5 coaches and entry for 6 events and locked its
    // submissions" reads as four things that were added.
    expect(
      describeSession(
        { "participant-added": 5, "coach-added": 5, "entry-submitted": 6, "submission-locked": 1 },
        SCHOOL,
        false
      )
    ).toBe(
      "Bagong Silang ES added 5 learners, 5 coaches and entry for 6 events, and locked its submissions"
    );
    expect(
      describeSession({ "participant-added": 1, "submission-locked": 1 }, SCHOOL, false)
    ).toBe("Bagong Silang ES added 1 learner and locked its submissions");
  });

  it("reads a capped session as a floor, never as an exact count", () => {
    expect(
      describeSession(
        { "participant-added": 5, "coach-added": 1, "entry-submitted": 6, "entry-withdrawn": 1 },
        SCHOOL,
        true
      )
    ).toBe(
      "Bagong Silang ES added 5+ learners, 1+ coaches and entry for 6+ events, and withdrew 1+ entries"
    );
  });

  it("never renders a blank school name into the sentence", () => {
    expect(describeSession({ "participant-added": 2 }, "", false)).toBe(
      "A school added 2 learners"
    );
    expect(describeSession({ "participant-added": 2 }, "   ", false)).toBe(
      "A school added 2 learners"
    );
  });

  it("is total: an empty tally still yields a sentence", () => {
    expect(describeSession({}, SCHOOL, false)).toBe("Bagong Silang ES made no recorded changes");
  });
});

describe("groupActivitySessions", () => {
  it("collapses one session's rows into a single item", () => {
    const feed = group([
      event({ kind: "participant-added", id: "1", at: "2026-08-23T05:00:00+00:00" }),
      event({ kind: "participant-added", id: "2", at: "2026-08-23T05:01:00+00:00" }),
      event({ kind: "coach-added", id: "3", at: "2026-08-23T05:02:00+00:00" }),
      event({ kind: "entry-submitted", id: "4", at: "2026-08-23T05:03:00+00:00" }),
    ]);

    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].id).toBe("session:s1");
    expect(feed.items[0].kind).toBe("session");
    expect(feed.items[0].title).toBe(
      "Bagong Silang ES added 2 learners, 1 coach and entry for 1 event"
    );
    // Multi-event sessions have no detail page to link to.
    expect(feed.items[0].href).toBeNull();
  });

  it("dates a session by its latest event so an active one stays on top", () => {
    const feed = group([
      // Session `old` started later than `busy` did, but stopped earlier. Ordering
      // on the start time would bury `busy` beneath it.
      event({ kind: "participant-added", sessionId: "busy", id: "1", at: "2026-08-23T04:00:00+00:00" }),
      event({ kind: "coach-added", sessionId: "busy", id: "2", at: "2026-08-23T05:50:00+00:00" }),
      event({
        kind: "participant-added",
        sessionId: "old",
        id: "3",
        at: "2026-08-23T04:30:00+00:00",
        schoolName: "Camarin ES",
      }),
    ]);

    expect(feed.items.map((item) => item.id)).toEqual(["session:busy", "session:old"]);
    expect(feed.items[0].at).toBe("2026-08-23T05:50:00+00:00");
  });

  it("calls a recent session in progress and gives it its start time", () => {
    const feed = group([
      event({ kind: "participant-added", id: "1", at: "2026-08-23T05:40:00+00:00" }),
      event({ kind: "coach-added", id: "2", at: "2026-08-23T05:55:00+00:00" }),
    ]);
    // 05:40Z is 1:40 PM in Manila, where the division is.
    expect(feed.items[0].meta).toBe("In progress · since 1:40 PM");
  });

  it("closes a session once it has been idle past the window", () => {
    const events = [
      event({ kind: "participant-added", id: "1", at: "2026-08-23T04:00:00+00:00" }),
      event({ kind: "coach-added", id: "2", at: "2026-08-23T04:20:00+00:00" }),
    ];
    // 04:20Z is 100 minutes before `now`, so the default 30-minute window has
    // long passed; the meta becomes the span instead of "In progress".
    expect(group(events).items[0].meta).toBe("12:00 PM to 12:20 PM");
    // And the window is an input: widen it and the same data is open again.
    expect(group(events, { idleMinutes: 240 }).items[0].meta).toBe("In progress · since 12:00 PM");
  });

  it("closes a session that a newer one for the same school has superseded", () => {
    const feed = group([
      // Both are inside the idle window, so only supersession can close the older.
      event({ kind: "participant-added", sessionId: "earlier", id: "1", at: "2026-08-23T05:40:00+00:00" }),
      event({ kind: "coach-added", sessionId: "later", id: "2", at: "2026-08-23T05:50:00+00:00" }),
    ]);

    const byId = new Map(feed.items.map((item) => [item.id, item]));
    expect(byId.get("session:earlier")?.meta).toBe("1:40 PM");
    expect(byId.get("session:later")?.meta).toBe("In progress · since 1:50 PM");
  });

  it("lets two schools each hold an open session at the same time", () => {
    const feed = group([
      event({ kind: "participant-added", sessionId: "a", id: "1", at: "2026-08-23T05:40:00+00:00" }),
      event({
        kind: "participant-added",
        sessionId: "b",
        id: "2",
        at: "2026-08-23T05:50:00+00:00",
        schoolName: "Camarin ES",
      }),
    ]);
    expect(feed.items.map((item) => item.meta)).toEqual([
      "In progress · since 1:50 PM",
      "In progress · since 1:40 PM",
    ]);
  });

  it("renders a row with no session id on its own, keeping its kind:rowid id", () => {
    const feed = group([
      event({ kind: "participant-added", sessionId: "s1", id: "1" }),
      event({
        kind: "coach-added",
        sessionId: null,
        id: "77",
        at: "2026-08-23T05:30:00+00:00",
        label: "Dela Cruz, Ana Mercado",
      }),
    ]);

    const ungrouped = feed.items.find((item) => item.id === "coach-added:77");
    expect(ungrouped).toBeDefined();
    // Not folded into s1, and not given a fabricated session of its own.
    expect(ungrouped?.kind).toBe("coach");
    expect(ungrouped?.title).toBe("Bagong Silang ES added 1 coach");
    expect(ungrouped?.meta).toBe("Dela Cruz, Ana Mercado");
    expect(ungrouped?.href).toBe("/admin/coaches");
    expect(feed.items.map((item) => item.id)).toContain("session:s1");
  });

  it("treats a blank session id the same as a null one", () => {
    const feed = group([event({ kind: "entry-submitted", sessionId: "   ", id: "9" })]);
    expect(feed.items.map((item) => item.id)).toEqual(["entry-submitted:9"]);
  });

  it("links a one-event session to its subject's list", () => {
    const feed = group([event({ kind: "submission-locked", id: "1" })]);
    expect(feed.items[0].href).toBe("/admin/school-papers");
  });

  it("turns a capped session into an at-least sentence", () => {
    const feed = group(
      [
        event({ kind: "participant-added", id: "1", at: "2026-08-23T04:00:00+00:00" }),
        event({ kind: "participant-added", id: "2", at: "2026-08-23T04:01:00+00:00" }),
      ],
      { capped: new Set(["s1"]) }
    );
    expect(feed.items[0].title).toBe("Bagong Silang ES added 2+ learners");
  });

  it("drops an unparseable timestamp without taking its session down with it", () => {
    const feed = group([
      event({ kind: "participant-added", id: "1", at: "2026-08-23T05:00:00+00:00" }),
      event({ kind: "coach-added", id: "2", at: "soon" }),
      { ...event({ kind: "coach-added", id: "3" }), at: null as unknown as string },
    ]);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe("Bagong Silang ES added 1 learner");
    expect(feed.items[0].at).toBe("2026-08-23T05:00:00+00:00");
  });

  it("merges the pre-cutoff rows into the same newest-first order", () => {
    const feed = group(
      [event({ kind: "participant-added", id: "1", at: "2026-08-23T05:00:00+00:00" })],
      {
        legacy: [
          legacyItem("entry:aaa", "2026-08-23T05:30:00+00:00"),
          legacyItem("entry:bbb", "2026-08-23T04:30:00+00:00"),
        ],
      }
    );
    expect(feed.items.map((item) => item.id)).toEqual([
      "entry:aaa",
      "session:s1",
      "entry:bbb",
    ]);
  });

  it("gives session ids a prefix no legacy id can collide with", () => {
    // mergeActivityFeed's tie-break is `id.localeCompare` on equal instants, so
    // two items sharing an id would make the order — and the render — unstable.
    const at = "2026-08-23T05:00:00+00:00";
    const uuid = "1f2e3d4c-5b6a-7980-9192-a3b4c5d6e7f8";
    const feed = group([event({ kind: "participant-added", sessionId: uuid, id: "1", at })], {
      legacy: [
        legacyItem(`entry:${uuid}`, at),
        legacyItem(`participant:${uuid}`, at),
        legacyItem(`coach:${uuid}`, at),
      ],
    });

    const ids = feed.items.map((item) => item.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toContain(`session:${uuid}`);
    // Ascending id on the tie, which is only total because every id differs.
    expect(ids).toEqual([
      `coach:${uuid}`,
      `entry:${uuid}`,
      `participant:${uuid}`,
      `session:${uuid}`,
    ]);
  });

  describe("truncated", () => {
    const oneSession = [event({ kind: "participant-added", id: "1" })];

    it("is false only when nothing was hidden anywhere", () => {
      expect(group(oneSession, { sessionsProbed: 1, limit: 20 }).truncated).toBe(false);
    });

    it("is true when the probe saw more sessions than the limit", () => {
      // `recent_activity_sessions` returns limit + 1 ids precisely so this is
      // knowable without fetching the extra session's rows.
      const feed = group(oneSession, { sessionsProbed: 3, limit: 2 });
      expect(feed.items).toHaveLength(1);
      expect(feed.truncated).toBe(true);
    });

    it("is true when a session's own event fetch was capped", () => {
      // Nothing is missing from the list, but "added 2+ learners" is a floor, so
      // this feed is still not the whole story.
      const feed = group(oneSession, { capped: new Set(["s1"]), sessionsProbed: 1, limit: 20 });
      expect(feed.items).toHaveLength(1);
      expect(feed.truncated).toBe(true);
    });

    it("is true when the legacy source came back holding its own limit", () => {
      const feed = group([], {
        legacy: [
          legacyItem("entry:a", "2026-08-23T05:00:00+00:00"),
          legacyItem("entry:b", "2026-08-23T04:00:00+00:00"),
        ],
        sessionsProbed: 0,
        limit: 2,
      });
      expect(feed.items).toHaveLength(2);
      expect(feed.truncated).toBe(true);
    });

    it("is true when the merge itself sliced at the limit", () => {
      const feed = group(
        [
          event({ kind: "participant-added", sessionId: "a", id: "1", at: "2026-08-23T05:00:00+00:00" }),
          event({
            kind: "participant-added",
            sessionId: "b",
            id: "2",
            at: "2026-08-23T04:00:00+00:00",
            schoolName: "Camarin ES",
          }),
        ],
        { sessionsProbed: 2, limit: 1 }
      );
      expect(feed.items.map((item) => item.id)).toEqual(["session:a"]);
      expect(feed.truncated).toBe(true);
    });
  });

  it("returns an empty feed for no events at all", () => {
    const feed = group([], { sessionsProbed: 0 });
    expect(feed.items).toEqual([]);
    expect(feed.truncated).toBe(false);
  });
});
