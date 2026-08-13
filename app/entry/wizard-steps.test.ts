import { describe, expect, it } from "vitest";

import { EVENT_TYPES, EVENTS_CATALOG } from "@/lib/events-catalog";
import {
  languagesFor,
  levelsForType,
  resolveEvent,
  typeLabel,
  typesForCategory,
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

describe("typesForCategory", () => {
  it("splits 10 individual and 6 group types", () => {
    expect(typesForCategory(types, "individual")).toHaveLength(10);
    expect(typesForCategory(types, "group")).toHaveLength(6);
  });

  it("returns them in sort order", () => {
    const orders = typesForCategory(types, "individual").map((t) => t.sort_order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe("levelsForType", () => {
  it("offers both levels for a standard contest", () => {
    expect(levelsForType(events, typeId("news-writing"))).toEqual([
      "elementary",
      "secondary",
    ]);
  });

  it.each(["mojo", "online-publishing", "tv-broadcasting-regular", "tv-broadcasting-spj"])(
    "offers only secondary for %s",
    (slug) => {
      expect(levelsForType(events, typeId(slug))).toEqual(["secondary"]);
    }
  );

  it("returns nothing for an unknown type", () => {
    expect(levelsForType(events, "nope")).toEqual([]);
  });
});

describe("languagesFor", () => {
  it("always offers both languages at an available level", () => {
    for (const type of types) {
      for (const level of levelsForType(events, type.id)) {
        expect(languagesFor(events, type.id, level), `${type.slug} ${level}`).toEqual([
          "english",
          "filipino",
        ]);
      }
    }
  });

  it("returns nothing for a level the contest is not offered at", () => {
    expect(languagesFor(events, typeId("mojo"), "elementary")).toEqual([]);
  });
});

describe("resolveEvent", () => {
  it("resolves exactly one event for every valid combination", () => {
    let resolved = 0;
    for (const type of types) {
      for (const level of levelsForType(events, type.id)) {
        for (const language of languagesFor(events, type.id, level)) {
          const event = resolveEvent(events, type.id, level, language);
          expect(event, `${type.slug} ${level} ${language}`).toBeDefined();
          expect(event!.event_type_id).toBe(type.id);
          resolved += 1;
        }
      }
    }
    expect(resolved).toBe(EVENTS_CATALOG.length);
  });

  it("returns undefined for a combination that does not exist", () => {
    expect(resolveEvent(events, typeId("mojo"), "elementary", "english")).toBeUndefined();
  });
});

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
