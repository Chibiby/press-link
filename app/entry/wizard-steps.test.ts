import { describe, expect, it } from "vitest";

import { EVENT_TYPES, EVENTS_CATALOG } from "@/lib/events-catalog";
import {
  isEventTaken,
  isEveryEventTaken,
  languagesFor,
  levelsFor,
  resolveEvent,
  takenEventIdsFor,
  typeLabel,
  typesFor,
  type EventRow,
  type EventTypeRow,
} from "./wizard-steps";

// Build DB-shaped fixtures from the catalog so the tests track the real data.
const types: EventTypeRow[] = EVENT_TYPES.map((t, i) => ({
  id: `type-${i}`,
  slug: t.slug,
  category: t.category,
  name_en: t.nameEn,
  name_fil: t.nameFil,
  min_participants: t.minParticipants,
  max_participants: t.maxParticipants,
  sort_order: t.sortOrder,
}));

const idBySlug = new Map(types.map((t) => [t.slug, t.id]));

const events: EventRow[] = EVENTS_CATALOG.map((e, i) => ({
  id: `event-${i}`,
  event_type_id: idBySlug.get(e.eventTypeSlug)!,
  category: e.category,
  level: e.level,
  language: e.language,
  name: e.name,
  sort_order: e.sortOrder,
}));

const typeId = (slug: string) => idBySlug.get(slug)!;
const eventId = (slug: string, level: EventRow["level"], language: EventRow["language"]) =>
  resolveEvent(events, typeId(slug), level, language)!.id;
const slugsFor = (
  category: EventRow["category"],
  level: EventRow["level"],
  language: EventRow["language"]
) => typesFor(types, events, category, level, language).map((t) => t.slug);

describe("levelsFor", () => {
  it("offers both levels for each category", () => {
    expect(levelsFor(events, "individual")).toEqual(["elementary", "secondary"]);
    expect(levelsFor(events, "group")).toEqual(["elementary", "secondary"]);
  });
});

describe("languagesFor", () => {
  it("offers both languages at every offered level", () => {
    for (const category of ["individual", "group"] as const) {
      for (const level of levelsFor(events, category)) {
        expect(languagesFor(events, category, level), `${category} ${level}`).toEqual([
          "english",
          "filipino",
        ]);
      }
    }
  });
});

describe("typesFor", () => {
  it("lists only the contests held at that level", () => {
    const secondary = slugsFor("individual", "secondary", "english");
    const elementary = slugsFor("individual", "elementary", "english");
    expect(secondary).toContain("mojo");
    expect(elementary).not.toContain("mojo");
  });

  it("returns them in sort order", () => {
    const orders = typesFor(types, events, "individual", "secondary", "english").map(
      (t) => t.sort_order
    );
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("covers every catalog event across both levels and languages", () => {
    let total = 0;
    for (const category of ["individual", "group"] as const) {
      for (const level of levelsFor(events, category)) {
        for (const language of languagesFor(events, category, level)) {
          total += typesFor(types, events, category, level, language).length;
        }
      }
    }
    expect(total).toBe(EVENTS_CATALOG.length);
  });
});

describe("resolveEvent", () => {
  it("resolves exactly one event for every combination the wizard can reach", () => {
    let resolved = 0;
    for (const category of ["individual", "group"] as const) {
      for (const level of levelsFor(events, category)) {
        for (const language of languagesFor(events, category, level)) {
          for (const type of typesFor(types, events, category, level, language)) {
            const event = resolveEvent(events, type.id, level, language);
            expect(event, `${type.slug} ${level} ${language}`).toBeDefined();
            expect(event!.event_type_id).toBe(type.id);
            resolved += 1;
          }
        }
      }
    }
    expect(resolved).toBe(EVENTS_CATALOG.length);
  });

  it("returns undefined for a combination that does not exist", () => {
    expect(resolveEvent(events, typeId("mojo"), "elementary", "english")).toBeUndefined();
  });
});

describe("takenEventIdsFor", () => {
  const entries = [
    { id: "entry-a", event_id: eventId("news-writing", "elementary", "english") },
    { id: "entry-b", event_id: eventId("news-writing", "elementary", "filipino") },
  ];

  it("collects every event the school has already used", () => {
    expect(takenEventIdsFor(entries, null)).toEqual(
      new Set([entries[0].event_id, entries[1].event_id])
    );
  });

  it("excludes the entry currently being edited so it can be re-saved", () => {
    expect(takenEventIdsFor(entries, "entry-a")).toEqual(new Set([entries[1].event_id]));
  });
});

describe("isEventTaken", () => {
  const taken = new Set([eventId("news-writing", "elementary", "english")]);

  it("flags the exact contest/level/language that is used", () => {
    expect(isEventTaken(events, typeId("news-writing"), "elementary", "english", taken)).toBe(
      true
    );
  });

  it("leaves the other language of the same contest free", () => {
    expect(isEventTaken(events, typeId("news-writing"), "elementary", "filipino", taken)).toBe(
      false
    );
  });

  it("leaves the other level of the same contest free", () => {
    expect(isEventTaken(events, typeId("news-writing"), "secondary", "english", taken)).toBe(
      false
    );
  });

  it("is false for a combination that does not exist", () => {
    expect(isEventTaken(events, typeId("mojo"), "elementary", "english", taken)).toBe(false);
  });
});

describe("isEveryEventTaken", () => {
  it("is false while any event under the filter is free", () => {
    const taken = new Set([eventId("news-writing", "elementary", "english")]);
    expect(
      isEveryEventTaken(events, { category: "individual", level: "elementary" }, taken)
    ).toBe(false);
  });

  it("is true once every event under the filter is used", () => {
    const taken = new Set(
      eventsMatchingIds({ category: "individual", level: "elementary", language: "english" })
    );
    expect(
      isEveryEventTaken(
        events,
        { category: "individual", level: "elementary", language: "english" },
        taken
      )
    ).toBe(true);
  });

  it("does not spill over into the other language", () => {
    const taken = new Set(
      eventsMatchingIds({ category: "individual", level: "elementary", language: "english" })
    );
    expect(
      isEveryEventTaken(
        events,
        { category: "individual", level: "elementary", language: "filipino" },
        taken
      )
    ).toBe(false);
  });

  it("is false when the filter matches nothing at all", () => {
    expect(isEveryEventTaken(events, { typeId: "nope" }, new Set())).toBe(false);
  });
});

function eventsMatchingIds(filter: {
  category?: EventRow["category"];
  level?: EventRow["level"];
  language?: EventRow["language"];
}): string[] {
  return events
    .filter(
      (e) =>
        (filter.category === undefined || e.category === filter.category) &&
        (filter.level === undefined || e.level === filter.level) &&
        (filter.language === undefined || e.language === filter.language)
    )
    .map((e) => e.id);
}

describe("typeLabel", () => {
  it("omits the Filipino label when both names match", () => {
    const group = types.find((t) => t.slug === "online-publishing")!;
    expect(typeLabel(group)).toEqual({ primary: "Online Publishing" });
  });

  it("shows both labels when they differ", () => {
    const news = types.find((t) => t.slug === "news-writing")!;
    expect(typeLabel(news)).toEqual({
      primary: "News Writing",
      secondary: "Pagsulat ng Balita",
    });
  });
});
