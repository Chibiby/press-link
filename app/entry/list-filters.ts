import type { EventLanguage, EventLevel } from "@/lib/events-catalog";
import type { UsageMap } from "@/lib/roster/limits";
import type { EntryRow, RosterCoach, RosterParticipant } from "./types";

/** Radix Select forbids an empty item value, so "any" stands in for "no filter". */
export const ANY = "__any__";

/** Whether a participant already sits in an entry. */
export type AssignmentFilter = typeof ANY | "assigned" | "unassigned";
export type GenderFilter = typeof ANY | "M" | "F";
export type LevelFilter = typeof ANY | EventLevel;
export type LanguageFilter = typeof ANY | EventLanguage;

/**
 * A school types the fragment it remembers — half a surname, a number off a
 * form — so this matches anywhere in any of the fields rather than only at the
 * start. An empty box is no filter, and trailing spaces from a paste are not a
 * reason to show nothing.
 */
export function matchesQuery(haystacks: string[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return haystacks.some((haystack) => haystack.toLowerCase().includes(needle));
}

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
  }: { query: string; level: LevelFilter; language: LanguageFilter }
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
    return language === ANY || entry.language === language;
  });
}
