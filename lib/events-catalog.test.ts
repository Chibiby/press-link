import { describe, expect, it } from "vitest";
import { EVENT_TYPES, EVENTS_CATALOG } from "./events-catalog";

const SECONDARY_ONLY = [
  "mojo",
  "online-publishing",
  "tv-broadcasting-regular",
  "tv-broadcasting-spj",
];

describe("EVENT_TYPES", () => {
  it("has 16 types: 10 individual, 6 group", () => {
    expect(EVENT_TYPES.length).toBe(16);
    expect(EVENT_TYPES.filter((t) => t.category === "individual").length).toBe(10);
    expect(EVENT_TYPES.filter((t) => t.category === "group").length).toBe(6);
  });

  it("has unique slugs and unique sort orders", () => {
    const slugs = EVENT_TYPES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const orders = EVENT_TYPES.map((t) => t.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("offers the secondary-only types at the secondary level alone", () => {
    for (const slug of SECONDARY_ONLY) {
      const type = EVENT_TYPES.find((t) => t.slug === slug);
      expect(type, `missing event type ${slug}`).toBeDefined();
      expect(type!.levels).toEqual(["secondary"]);
    }
  });

  it("offers every other type at both levels", () => {
    for (const type of EVENT_TYPES) {
      if (SECONDARY_ONLY.includes(type.slug)) continue;
      expect(type.levels, type.slug).toEqual(["elementary", "secondary"]);
    }
  });
});

describe("EVENTS_CATALOG", () => {
  it("has exactly 56 events", () => {
    expect(EVENTS_CATALOG.length).toBe(56);
  });

  it("has 38 individual and 18 group events", () => {
    expect(EVENTS_CATALOG.filter((e) => e.category === "individual").length).toBe(38);
    expect(EVENTS_CATALOG.filter((e) => e.category === "group").length).toBe(18);
  });

  it("has unique codes", () => {
    const codes = EVENTS_CATALOG.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("uses a uniform {slug}-{elem|sec}-{eng|fil} code shape", () => {
    // v1 seeded the six secondary-only group rows as `{slug}-{lang}`, e.g.
    // `online-publishing-eng`. v2 normalizes all 56.
    for (const event of EVENTS_CATALOG) {
      expect(event.code, event.code).toMatch(/^[a-z0-9-]+-(elem|sec)-(eng|fil)$/);
    }
    expect(EVENTS_CATALOG.map((e) => e.code)).toContain("online-publishing-sec-eng");
  });

  it("resolves every eventTypeSlug to a known type", () => {
    const slugs = new Set(EVENT_TYPES.map((t) => t.slug));
    for (const event of EVENTS_CATALOG) {
      expect(slugs.has(event.eventTypeSlug), event.code).toBe(true);
    }
  });

  it("only offers the secondary-only types at the secondary level", () => {
    for (const slug of SECONDARY_ONLY) {
      const rows = EVENTS_CATALOG.filter((e) => e.eventTypeSlug === slug);
      expect(rows.length, slug).toBe(2);
      expect(rows.every((e) => e.level === "secondary"), slug).toBe(true);
    }
  });

  it("names each row from its type's language-specific label", () => {
    for (const event of EVENTS_CATALOG) {
      const type = EVENT_TYPES.find((t) => t.slug === event.eventTypeSlug)!;
      expect(event.name, event.code).toBe(
        event.language === "filipino" ? type.nameFil : type.nameEn
      );
    }
  });

  it("carries the same category as its type", () => {
    for (const event of EVENTS_CATALOG) {
      const type = EVENT_TYPES.find((t) => t.slug === event.eventTypeSlug)!;
      expect(event.category, event.code).toBe(type.category);
    }
  });
});

describe("participant counts", () => {
  it("allows 1 to 3 participants for every individual type", () => {
    for (const type of EVENT_TYPES.filter((t) => t.category === "individual")) {
      expect(type.minParticipants).toBe(1);
      expect(type.maxParticipants).toBe(3);
    }
  });

  it("requires exactly 7 for the five seven-member group contests", () => {
    const sevens = [
      "radio-broadcasting-regular",
      "radio-broadcasting-spj",
      "collaborative-publishing",
      "tv-broadcasting-regular",
      "tv-broadcasting-spj",
    ];
    for (const slug of sevens) {
      const type = EVENT_TYPES.find((t) => t.slug === slug);
      expect(type?.minParticipants).toBe(7);
      expect(type?.maxParticipants).toBe(7);
    }
  });

  it("leaves online publishing unbounded above 2", () => {
    const type = EVENT_TYPES.find((t) => t.slug === "online-publishing");
    expect(type?.minParticipants).toBe(2);
    expect(type?.maxParticipants).toBeNull();
  });
});
