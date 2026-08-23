import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import type { UsageMap } from "@/lib/roster/limits";
import { matchesQuery } from "@/lib/search/matches-query";
import type { EntryRow, RosterCoach, RosterParticipant } from "./types";

/** Radix Select forbids an empty item value, so "any" stands in for "no filter". */
export const ANY = "__any__";

/** Whether a participant already sits in an entry. */
export type AssignmentFilter = typeof ANY | "assigned" | "unassigned";
export type GenderFilter = typeof ANY | "M" | "F";
export type LevelFilter = typeof ANY | EventLevel;
export type LanguageFilter = typeof ANY | EventLanguage;
/** Whether an event is contested by one learner or by a team. */
export type CategoryFilter = typeof ANY | EventCategory;

// `matchesQuery` used to live here. The admin tables above these lists ask the
// same question of their rows, so it moved to `@/lib/search/matches-query`
// unchanged — with its tests — and the three filters below now import it. The
// filters themselves stay: they are about this school's own lists.

/** A participant with no usage entry has never been picked, so they count here. */
function isUnassigned(usage: UsageMap[string] | undefined): boolean {
  return (usage?.individualCount ?? 0) === 0 && (usage?.groupCount ?? 0) === 0;
}

export function filterParticipants(
  participants: RosterParticipant[],
  {
    query,
    usage,
    assignment,
  }: { query: string; usage: UsageMap; assignment: AssignmentFilter }
): RosterParticipant[] {
  return participants.filter((participant) => {
    // A school knows a contestant by the number it wrote on the form as often
    // as by name, so the number is searchable too.
    if (!matchesQuery([participant.full_name, participant.number_label], query)) {
      return false;
    }
    if (assignment === ANY) return true;
    return assignment === "unassigned"
      ? isUnassigned(usage[participant.id])
      : !isUnassigned(usage[participant.id]);
  });
}

export function filterCoaches(
  coaches: RosterCoach[],
  { query, gender }: { query: string; gender: GenderFilter }
): RosterCoach[] {
  return coaches.filter((coach) => {
    if (!matchesQuery([coach.full_name], query)) return false;
    return gender === ANY || coach.gender === gender;
  });
}

export function filterEntries(
  entries: EntryRow[],
  {
    query,
    level,
    language,
    category,
  }: {
    query: string;
    level: LevelFilter;
    language: LanguageFilter;
    category: CategoryFilter;
  }
): EntryRow[] {
  return entries.filter((entry) => {
    // "Where is Cruz entered?" is the question a school actually asks, so a
    // name on the entry finds it just as the event's own name does.
    const searchable = [
      entry.event_name,
      ...entry.participants.map((participant) => participant.full_name),
      ...entry.coaches.map((coach) => coach.full_name),
    ];
    if (!matchesQuery(searchable, query)) return false;
    if (level !== ANY && entry.level !== level) return false;
    if (language !== ANY && entry.language !== language) return false;
    // Individual and group are the two halves of the contest, and a school
    // preparing one of them has no use for the other on screen.
    return category === ANY || entry.category === category;
  });
}
