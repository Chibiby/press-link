import { describe, expect, it } from "vitest";

import {
  joinMeta,
  mergeActivity,
  mergeActivityFeed,
  personLabel,
  relativeTime,
  type ActivityItem,
} from "./activity";

function item(id: string, at: string, kind: ActivityItem["kind"] = "entry"): ActivityItem {
  return { id, kind, at, title: id, meta: null, href: null };
}

describe("mergeActivity", () => {
  it("interleaves the sources newest first", () => {
    const merged = mergeActivity(
      [
        [item("a", "2026-08-19T10:00:00+00:00"), item("b", "2026-08-17T10:00:00+00:00")],
        [item("c", "2026-08-18T10:00:00+00:00")],
      ],
      10
    );
    expect(merged.map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("stops at the limit", () => {
    const merged = mergeActivity(
      [
        [item("a", "2026-08-19T10:00:00+00:00")],
        [item("b", "2026-08-18T10:00:00+00:00")],
        [item("c", "2026-08-17T10:00:00+00:00")],
      ],
      2
    );
    expect(merged.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("compares instants, not strings", () => {
    // 09:00+08:00 is 01:00Z — earlier than 02:00Z, though it sorts later as text.
    const merged = mergeActivity(
      [[item("manila", "2026-08-19T09:00:00+08:00")], [item("utc", "2026-08-19T02:00:00+00:00")]],
      10
    );
    expect(merged.map((i) => i.id)).toEqual(["utc", "manila"]);
  });

  it("drops rows whose timestamp is missing or unparseable", () => {
    const merged = mergeActivity(
      [[item("good", "2026-08-19T10:00:00+00:00"), item("blank", ""), item("junk", "soon")]],
      10
    );
    expect(merged.map((i) => i.id)).toEqual(["good"]);
  });

  it("breaks ties on id so the order is stable between renders", () => {
    const at = "2026-08-19T10:00:00+00:00";
    const merged = mergeActivity([[item("zulu", at)], [item("alfa", at)]], 10);
    expect(merged.map((i) => i.id)).toEqual(["alfa", "zulu"]);
  });

  it("handles no sources and empty sources", () => {
    expect(mergeActivity([], 10)).toEqual([]);
    expect(mergeActivity([[], []], 10)).toEqual([]);
  });

  it("does not mutate the caller's arrays", () => {
    const source = [item("b", "2026-08-17T10:00:00+00:00"), item("a", "2026-08-19T10:00:00+00:00")];
    mergeActivity([source], 10);
    expect(source.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("never sorts a null timestamp to the top of the feed", () => {
    // `schools.paper_answered_at` and `schools.submission_locked_at` are both
    // nullable, so a null reaches here typed as a string. It must drop out, not
    // lead an admin's feed.
    const nulled = { ...item("nulled", ""), at: null as unknown as string };
    const merged = mergeActivity([[nulled, item("real", "2026-08-19T10:00:00+00:00")]], 10);
    expect(merged.map((i) => i.id)).toEqual(["real"]);
  });
});

describe("mergeActivityFeed", () => {
  it("flags the cap when the merge itself drops items", () => {
    const feed = mergeActivityFeed(
      [
        [
          item("a", "2026-08-19T10:00:00+00:00"),
          item("b", "2026-08-18T10:00:00+00:00"),
          item("c", "2026-08-17T10:00:00+00:00"),
        ],
      ],
      2
    );
    expect(feed.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(feed.truncated).toBe(true);
  });

  it("flags the cap when a source came back full, even though the merge dropped nothing", () => {
    // The query behind this source was capped at 2 as well, so a third row may
    // sit in the database that this feed never saw. Showing 2 of 2 is still not
    // "everything".
    const feed = mergeActivityFeed(
      [[item("a", "2026-08-19T10:00:00+00:00"), item("b", "2026-08-18T10:00:00+00:00")]],
      2
    );
    expect(feed.items).toHaveLength(2);
    expect(feed.truncated).toBe(true);
  });

  it("is complete only when every source came back short of the limit", () => {
    const feed = mergeActivityFeed(
      [[item("a", "2026-08-19T10:00:00+00:00")], [item("b", "2026-08-18T10:00:00+00:00")]],
      5
    );
    expect(feed.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(feed.truncated).toBe(false);
    expect(mergeActivityFeed([], 10).truncated).toBe(false);
  });
});

describe("personLabel", () => {
  it("keeps a real name and never yields a dangling sentence for a blank one", () => {
    // `coaches.first_name` / `last_name` default to '' (migration 0015), so
    // surnameFirst() can hand back "" for a row that really exists.
    expect(personLabel("Dela Cruz, Ana Mercado")).toBe("Dela Cruz, Ana Mercado");
    expect(personLabel("")).toBe("Name not yet recorded");
    expect(personLabel("   ")).toBe("Name not yet recorded");
    expect(personLabel(null)).toBe("Name not yet recorded");
    expect(personLabel("", "Unnamed coach")).toBe("Unnamed coach");
  });
});

describe("joinMeta", () => {
  it("drops blank parts rather than trailing a separator", () => {
    expect(joinMeta("Bagong Silang ES", "Dela Cruz, Ana")).toBe("Bagong Silang ES · Dela Cruz, Ana");
    expect(joinMeta("Bagong Silang ES", "")).toBe("Bagong Silang ES");
    expect(joinMeta("", "Dela Cruz, Ana")).toBe("Dela Cruz, Ana");
  });

  it("is null when nothing survives, so the panel renders no meta line at all", () => {
    expect(joinMeta("", "   ", null, undefined)).toBeNull();
    expect(joinMeta()).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-08-19T12:00:00+00:00");

  it("calls the last minute just now", () => {
    expect(relativeTime("2026-08-19T11:59:30+00:00", now)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(relativeTime("2026-08-19T11:45:00+00:00", now)).toBe("15m ago");
    expect(relativeTime("2026-08-19T09:00:00+00:00", now)).toBe("3h ago");
    expect(relativeTime("2026-08-17T12:00:00+00:00", now)).toBe("2d ago");
  });

  it("switches to a date once a week has passed", () => {
    expect(relativeTime("2026-07-04T12:00:00+00:00", now)).toBe("Jul 4");
  });

  it("does not invent a future", () => {
    // Clock skew between the database and the server should read as "just now",
    // never as "-3m ago".
    expect(relativeTime("2026-08-19T12:00:30+00:00", now)).toBe("just now");
  });
});
