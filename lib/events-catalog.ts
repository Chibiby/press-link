export type EventCategory = "individual" | "group";
export type EventLevel = "elementary" | "secondary";
export type EventLanguage = "english" | "filipino";

/**
 * A contest as a school thinks of it — language-neutral. The entry wizard picks
 * a type first, then narrows to a concrete `EventSeed` by level and language.
 */
export interface EventTypeSeed {
  slug: string;
  category: EventCategory;
  nameEn: string;
  nameFil: string;
  /** Levels this contest is actually offered at. */
  levels: readonly EventLevel[];
  /** Fewest participants a single entry may carry. */
  minParticipants: number;
  /** Most participants a single entry may carry; null means unbounded. */
  maxParticipants: number | null;
  sortOrder: number;
}

/** One concrete contest slot: a type at a level in a language. */
export interface EventSeed {
  code: string;
  eventTypeSlug: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  name: string;
  sortOrder: number;
}

const BOTH_LEVELS = ["elementary", "secondary"] as const;
const SECONDARY_ONLY = ["secondary"] as const;
const LANGUAGES = ["english", "filipino"] as const;

/**
 * Names are taken verbatim from the DSPC source workbook — do not "correct"
 * them. Group contests and MOJO carry identical English and Filipino labels
 * there, so `nameEn` and `nameFil` are deliberately equal for those.
 */
export const EVENT_TYPES: EventTypeSeed[] = [
  // Individual
  { slug: "news-writing", category: "individual", nameEn: "News Writing", nameFil: "Pagsulat ng Balita", levels: BOTH_LEVELS, minParticipants: 1, maxParticipants: 3, sortOrder: 1 },
  { slug: "editorial-writing", category: "individual", nameEn: "Editorial Writing", nameFil: "Pagsulat ng Editoryal", levels: BOTH_LEVELS, minParticipants: 1, maxParticipants: 3, sortOrder: 2 },
  { slug: "column-writing", category: "individual", nameEn: "Column Writing", nameFil: "Pagsulat ng Kolum", levels: BOTH_LEVELS, minParticipants: 1, maxParticipants: 3, sortOrder: 3 },
  { slug: "feature-writing", category: "individual", nameEn: "Feature Writing", nameFil: "Pagsulat ng Lathalain", levels: BOTH_LEVELS, minParticipants: 1, maxParticipants: 3, sortOrder: 4 },
  { slug: "sci-tech-writing", category: "individual", nameEn: "Science & Technology Writing", nameFil: "Pagsulat ng Agham at Teknolohiya", levels: BOTH_LEVELS, minParticipants: 1, maxParticipants: 3, sortOrder: 5 },
  { slug: "editorial-cartooning", category: "individual", nameEn: "Editorial Cartooning", nameFil: "Pagguhit ng Kartung Editoryal", levels: BOTH_LEVELS, minParticipants: 1, maxParticipants: 3, sortOrder: 6 },
  { slug: "photojournalism", category: "individual", nameEn: "Photojourn", nameFil: "Pagkuha ng Larawang Pampahayagan", levels: BOTH_LEVELS, minParticipants: 1, maxParticipants: 3, sortOrder: 7 },
  { slug: "sports-writing", category: "individual", nameEn: "Sports Writing", nameFil: "Pagsulat ng Isports", levels: BOTH_LEVELS, minParticipants: 1, maxParticipants: 3, sortOrder: 8 },
  { slug: "copy-editing", category: "individual", nameEn: "Copy Editing & Headline Writing", nameFil: "Pagwawasto at Pag-uulo ng Balita", levels: BOTH_LEVELS, minParticipants: 1, maxParticipants: 3, sortOrder: 9 },
  { slug: "mojo", category: "individual", nameEn: "MOJO", nameFil: "MOJO", levels: SECONDARY_ONLY, minParticipants: 1, maxParticipants: 3, sortOrder: 10 },

  // Group
  { slug: "radio-broadcasting-regular", category: "group", nameEn: "Radio Broadcasting and Scriptwriting (Regular)", nameFil: "Radio Broadcasting and Scriptwriting (Regular)", levels: BOTH_LEVELS, minParticipants: 7, maxParticipants: 7, sortOrder: 11 },
  { slug: "collaborative-publishing", category: "group", nameEn: "Collaborative Publishing", nameFil: "Collaborative Publishing", levels: BOTH_LEVELS, minParticipants: 7, maxParticipants: 7, sortOrder: 12 },
  { slug: "radio-broadcasting-spj", category: "group", nameEn: "Radio Broadcasting and Scriptwriting (SPJ)", nameFil: "Radio Broadcasting and Scriptwriting (SPJ)", levels: BOTH_LEVELS, minParticipants: 7, maxParticipants: 7, sortOrder: 13 },
  { slug: "online-publishing", category: "group", nameEn: "Online Publishing", nameFil: "Online Publishing", levels: SECONDARY_ONLY, minParticipants: 2, maxParticipants: null, sortOrder: 14 },
  { slug: "tv-broadcasting-regular", category: "group", nameEn: "TV Broadcasting and Scriptwriting (Regular)", nameFil: "TV Broadcasting and Scriptwriting (Regular)", levels: SECONDARY_ONLY, minParticipants: 7, maxParticipants: 7, sortOrder: 15 },
  { slug: "tv-broadcasting-spj", category: "group", nameEn: "TV Broadcasting and Scriptwriting (SPJ)", nameFil: "TV Broadcasting and Scriptwriting (SPJ)", levels: SECONDARY_ONLY, minParticipants: 7, maxParticipants: 7, sortOrder: 16 },
];

export function levelTag(level: EventLevel): "elem" | "sec" {
  return level === "elementary" ? "elem" : "sec";
}

export function langTag(language: EventLanguage): "eng" | "fil" {
  return language === "english" ? "eng" : "fil";
}

function buildCatalog(): EventSeed[] {
  const events: EventSeed[] = [];
  let sortOrder = 1;

  for (const type of EVENT_TYPES) {
    for (const level of type.levels) {
      for (const language of LANGUAGES) {
        events.push({
          code: `${type.slug}-${levelTag(level)}-${langTag(language)}`,
          eventTypeSlug: type.slug,
          category: type.category,
          level,
          language,
          name: language === "filipino" ? type.nameFil : type.nameEn,
          sortOrder: sortOrder++,
        });
      }
    }
  }

  return events;
}

export const EVENTS_CATALOG: EventSeed[] = buildCatalog();
