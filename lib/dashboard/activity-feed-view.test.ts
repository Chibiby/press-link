import { describe, expect, it } from "vitest";

import type { ActivityItem } from "./activity";
import { groupActivitySessions, type SessionEvent } from "./activity-sessions";
import {
  isLoggedRow,
  isSessionInProgress,
  untrackedDivider,
} from "./activity-feed-view";

/** A legacy row, as `activity-source.ts` builds them: `<ActivityKind>:<rowid>`. */
function legacy(id: string, at: string): ActivityItem {
  return { id, kind: "entry", at, title: id, meta: null, href: null };
}

function session(id: string, at: string, meta: string | null = null): ActivityItem {
  return { id: `session:${id}`, kind: "session", at, title: id, meta, href: null };
}

function event(over: Partial<SessionEvent> & Pick<SessionEvent, "id" | "at">): SessionEvent {
  return {
    sessionId: "11111111-1111-4111-8111-111111111111",
    schoolName: "Bagong Silang ES",
    kind: "participant-added",
    label: null,
    ...over,
  };
}

describe("isLoggedRow", () => {
  it("accepts a grouped session", () => {
    expect(isLoggedRow(session("a", "2026-08-23T06:00:00+00:00"))).toBe(true);
  });

  it("accepts an ungrouped activity_events row", () => {
    expect(isLoggedRow(legacy("participant-added:7", "2026-08-23T06:00:00+00:00"))).toBe(true);
    expect(isLoggedRow(legacy("submission-locked:7", "2026-08-23T06:00:00+00:00"))).toBe(true);
  });

  it("rejects the six legacy sources, including the near-misses", () => {
    for (const id of [
      "entry:7",
      "participant:7",
      "coach:7",
      "paper-answer:7",
      "submission-lock:7",
      "paper-update:7",
    ]) {
      expect(isLoggedRow(legacy(id, "2026-08-20T06:00:00+00:00"))).toBe(false);
    }
  });

  it("rejects an id with no prefix at all rather than mis-slicing it", () => {
    expect(isLoggedRow(legacy("entry-submitted", "2026-08-23T06:00:00+00:00"))).toBe(false);
  });
});

describe("untrackedDivider", () => {
  it("draws nothing when nothing is logged — the unmigrated database", () => {
    const items = [
      legacy("entry:1", "2026-08-22T06:00:00+00:00"),
      legacy("participant:2", "2026-08-21T06:00:00+00:00"),
    ];
    expect(untrackedDivider(items)).toBeNull();
  });

  it("draws nothing when there is no legacy tail under it", () => {
    const items = [
      session("a", "2026-08-23T06:00:00+00:00"),
      legacy("coach-added:2", "2026-08-23T05:00:00+00:00"),
    ];
    expect(untrackedDivider(items)).toBeNull();
  });

  it("draws nothing for an empty feed", () => {
    expect(untrackedDivider([])).toBeNull();
  });

  it("breaks after the last logged row and dates the newest row under it", () => {
    const items = [
      session("a", "2026-08-23T08:00:00+00:00"),
      legacy("coach-added:9", "2026-08-23T07:00:00+00:00"),
      legacy("entry:1", "2026-08-22T22:30:00+00:00"),
      legacy("participant:2", "2026-08-19T06:00:00+00:00"),
    ];
    // 22:30Z on the 22nd is 06:30 on the 23rd in Manila, which is the point of
    // pinning the formatter.
    expect(untrackedDivider(items)).toEqual({
      index: 2,
      label: "Before session tracking (up to Aug 23, 2026)",
    });
  });

  it("keeps a legacy row above the break rather than a logged row below it", () => {
    const items = [
      legacy("entry:1", "2026-08-23T09:00:00+00:00"),
      session("a", "2026-08-23T08:00:00+00:00"),
      legacy("participant:2", "2026-08-19T06:00:00+00:00"),
    ];
    expect(untrackedDivider(items)?.index).toBe(2);
  });
});

describe("isSessionInProgress", () => {
  /** The feed as the real pure function builds it, so the wording stays pinned. */
  function feed(now: string, events: SessionEvent[]) {
    return groupActivitySessions({
      events,
      capped: new Set(),
      legacy: [],
      sessionsProbed: 1,
      limit: 10,
      now: new Date(now),
    }).items;
  }

  it("agrees with groupActivitySessions on an open session", () => {
    const items = feed("2026-08-23T06:25:00+00:00", [
      event({ id: "1", at: "2026-08-23T06:14:00+00:00" }),
      event({ id: "2", at: "2026-08-23T06:20:00+00:00", kind: "coach-added" }),
    ]);

    expect(items).toHaveLength(1);
    // The exact string design §2 specifies, formatted in Manila by the pure
    // function. If this ever changes, the badge below must change with it.
    expect(items[0].meta).toBe("In progress · since 2:14 PM");
    expect(isSessionInProgress(items[0])).toBe(true);
  });

  it("agrees with groupActivitySessions on a session gone idle", () => {
    const items = feed("2026-08-23T09:00:00+00:00", [
      event({ id: "1", at: "2026-08-23T06:14:00+00:00" }),
      event({ id: "2", at: "2026-08-23T06:20:00+00:00", kind: "coach-added" }),
    ]);

    expect(items[0].meta).toBe("2:14 PM to 2:20 PM");
    expect(isSessionInProgress(items[0])).toBe(false);
  });

  it("is false for a row that is not a session, whatever its meta says", () => {
    expect(isSessionInProgress({ ...legacy("entry:1", "2026-08-22T06:00:00+00:00"), meta: "In progress" })).toBe(false);
  });
});
