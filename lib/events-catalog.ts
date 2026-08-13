export type EventCategory = "individual" | "group";
export type EventLevel = "elementary" | "secondary";
export type EventLanguage = "english" | "filipino";

export interface EventSeed {
  code: string;
  category: EventCategory;
  level: EventLevel;
  language: EventLanguage;
  name: string;
  sortOrder: number;
}

const INDIVIDUAL_EVENTS: { slug: string; nameEn: string; nameFil: string }[] = [
  { slug: "news-writing", nameEn: "News Writing", nameFil: "Pagsulat ng Balita" },
  { slug: "editorial-writing", nameEn: "Editorial Writing", nameFil: "Pagsulat ng Editoryal" },
  { slug: "column-writing", nameEn: "Column Writing", nameFil: "Pagsulat ng Kolum" },
  { slug: "feature-writing", nameEn: "Feature Writing", nameFil: "Pagsulat ng Lathalain" },
  { slug: "sci-tech-writing", nameEn: "Science & Technology Writing", nameFil: "Pagsulat ng Agham at Teknolohiya" },
  { slug: "editorial-cartooning", nameEn: "Editorial Cartooning", nameFil: "Pagguhit ng Kartung Editoryal" },
  { slug: "photojournalism", nameEn: "Photojourn", nameFil: "Pagkuha ng Larawang Pampahayagan" },
  { slug: "sports-writing", nameEn: "Sports Writing", nameFil: "Pagsulat ng Isports" },
  { slug: "copy-editing", nameEn: "Copy Editing & Headline Writing", nameFil: "Pagwawasto at Pag-uulo ng Balita" },
];

const GROUP_EVENTS_ALL_LEVELS: { slug: string; name: string }[] = [
  { slug: "radio-broadcasting-regular", name: "Radio Broadcasting and Scriptwriting (Regular)" },
  { slug: "collaborative-publishing", name: "Collaborative Publishing" },
  { slug: "radio-broadcasting-spj", name: "Radio Broadcasting and Scriptwriting (SPJ)" },
];

const GROUP_EVENTS_SECONDARY_ONLY: { slug: string; name: string }[] = [
  { slug: "online-publishing", name: "Online Publishing" },
  { slug: "tv-broadcasting-regular", name: "TV Broadcasting and Scriptwriting (Regular)" },
  { slug: "tv-broadcasting-spj", name: "TV Broadcasting and Scriptwriting (SPJ)" },
];

function levelTag(level: EventLevel): "elem" | "sec" {
  return level === "elementary" ? "elem" : "sec";
}

function langTag(language: EventLanguage): "eng" | "fil" {
  return language === "english" ? "eng" : "fil";
}

function buildIndividualEvents(): EventSeed[] {
  const events: EventSeed[] = [];
  let sortOrder = 1;

  for (const level of ["elementary", "secondary"] as const) {
    for (const language of ["english", "filipino"] as const) {
      for (const ev of INDIVIDUAL_EVENTS) {
        events.push({
          code: `${ev.slug}-${levelTag(level)}-${langTag(language)}`,
          category: "individual",
          level,
          language,
          name: language === "english" ? ev.nameEn : ev.nameFil,
          sortOrder: sortOrder++,
        });
      }
      if (level === "secondary") {
        events.push({
          code: `mojo-sec-${langTag(language)}`,
          category: "individual",
          level: "secondary",
          language,
          name: "MOJO",
          sortOrder: sortOrder++,
        });
      }
    }
  }

  return events;
}

function buildGroupEvents(): EventSeed[] {
  const events: EventSeed[] = [];
  let sortOrder = 1;

  for (const level of ["elementary", "secondary"] as const) {
    for (const language of ["english", "filipino"] as const) {
      for (const ev of GROUP_EVENTS_ALL_LEVELS) {
        events.push({
          code: `${ev.slug}-${levelTag(level)}-${langTag(language)}`,
          category: "group",
          level,
          language,
          name: ev.name,
          sortOrder: sortOrder++,
        });
      }
      if (level === "secondary") {
        for (const ev of GROUP_EVENTS_SECONDARY_ONLY) {
          events.push({
            code: `${ev.slug}-${langTag(language)}`,
            category: "group",
            level: "secondary",
            language,
            name: ev.name,
            sortOrder: sortOrder++,
          });
        }
      }
    }
  }

  return events;
}

export const EVENTS_CATALOG: EventSeed[] = [...buildIndividualEvents(), ...buildGroupEvents()];
