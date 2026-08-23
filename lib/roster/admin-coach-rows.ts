import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import { surnameFirst } from "./names";

/** A `coaches` row joined to its school and entries, as `/admin/coaches` fetches it. */
export interface RawAdminCoach {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
  schools: {
    id: string;
    name: string;
    district_id: string;
    districts: { name: string } | null;
  } | null;
  entry_coaches: {
    entries: {
      id: string;
      event_id: string;
      events: {
        category: EventCategory;
        level: EventLevel;
        language: EventLanguage;
      } | null;
    } | null;
  }[];
}

export interface AdminCoachRow {
  id: string;
  fullName: string;
  /** Asterisked when the coach sits on more than one entry, as participants are. */
  displayName: string;
  gender: "M" | "F";
  schoolId: string;
  schoolName: string;
  districtId: string;
  districtName: string;
  entryCount: number;
  isMultiEntry: boolean;
  /** The dimensions of the entries this coach is on, deduped, in first-seen order. */
  eventIds: string[];
  categories: EventCategory[];
  levels: EventLevel[];
  languages: EventLanguage[];
}

export interface CoachFilters {
  district?: string;
  school?: string;
  gender?: string;
  multi?: string;
  unassigned?: string;
  event?: string;
  category?: string;
  level?: string;
  language?: string;
}

export function toAdminCoachRows(raw: RawAdminCoach[]): AdminCoachRow[] {
  return raw
    .map((row) => {
      // Deduped by entry, not counted by link row: a coach who takes two
      // contestants in one contest is two rows on one entry, and that is one
      // entry — otherwise they would be marked as working several.
      const entries = [
        ...new Map(
          row.entry_coaches
            .map((link) => link.entries)
            .filter((e): e is NonNullable<typeof e> => e !== null)
            .map((e) => [e.id, e] as const)
        ).values(),
      ];
      const entryCount = entries.length;
      const isMultiEntry = entryCount > 1;

      // Deduped with a Set but emitted as arrays: the page renders them, and a
      // stable first-seen order keeps the table from reshuffling between loads.
      const eventIds = [...new Set(entries.map((e) => e.event_id))];
      const categories = [
        ...new Set(entries.map((e) => e.events?.category).filter((v): v is EventCategory => !!v)),
      ];
      const levels = [
        ...new Set(entries.map((e) => e.events?.level).filter((v): v is EventLevel => !!v)),
      ];
      const languages = [
        ...new Set(entries.map((e) => e.events?.language).filter((v): v is EventLanguage => !!v)),
      ];

      const fullName = surnameFirst(row);

      return {
        id: row.id,
        fullName,
        displayName: isMultiEntry ? `*${fullName}` : fullName,
        gender: row.gender,
        schoolId: row.schools?.id ?? "",
        schoolName: row.schools?.name ?? "",
        districtId: row.schools?.district_id ?? "",
        districtName: row.schools?.districts?.name ?? "",
        entryCount,
        isMultiEntry,
        eventIds,
        categories,
        levels,
        languages,
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * Filters arrive as URL search params, so an unrecognised value is treated as
 * no filter rather than as a filter nothing matches — see the sibling reasoning
 * in lib/paper/admin-papers.ts.
 */
export function filterCoachRows(
  rows: AdminCoachRow[],
  filters: CoachFilters
): AdminCoachRow[] {
  const { gender, category, level, language } = filters;

  return rows.filter((row) => {
    if (filters.district && row.districtId !== filters.district) return false;
    if (filters.school && row.schoolId !== filters.school) return false;
    if ((gender === "M" || gender === "F") && row.gender !== gender) return false;
    if (filters.multi === "1" && !row.isMultiEntry) return false;
    if (filters.unassigned === "1" && row.entryCount > 0) return false;
    if (filters.event && !row.eventIds.includes(filters.event)) return false;
    if (
      (category === "individual" || category === "group") &&
      !row.categories.includes(category)
    ) {
      return false;
    }
    if (
      (level === "elementary" || level === "secondary") &&
      !row.levels.includes(level)
    ) {
      return false;
    }
    if (
      (language === "english" || language === "filipino") &&
      !row.languages.includes(language)
    ) {
      return false;
    }
    return true;
  });
}
