/**
 * The dashboard's six headline tiles.
 *
 * Every tile carries a subtitle, and that is the whole point of this module.
 * This division has 332 registered schools and 16 that have entered anything;
 * 383 learners on the roster and 114 of them on no entry at all. A tile showing
 * a bare count would read as a participation figure and be wrong by 20x.
 */
export type KpiKey = "schools" | "learners" | "coaches" | "entries" | "events" | "districts";

export interface Kpi {
  key: KpiKey;
  label: string;
  value: number;
  subtitle: string;
}

export interface KpiInput {
  schoolsRegistered: number;
  schoolsWithEntries: number;
  participants: number;
  participantsWithoutEntry: number;
  coaches: number;
  coachesWithoutEntry: number;
  entries: number;
  entriesIndividual: number;
  entriesGroup: number;
  eventTypes: number;
  eventTypesContested: number;
  districtsRegistered: number;
  districtsWithEntries: number;
}

export function buildKpis(input: KpiInput): Kpi[] {
  return [
    {
      key: "schools",
      label: "Registered Schools",
      value: input.schoolsWithEntries,
      subtitle: `of ${input.schoolsRegistered} registered`,
    },
    {
      key: "learners",
      label: "Learners",
      value: input.participants,
      subtitle: `${input.participantsWithoutEntry} not yet entered`,
    },
    {
      key: "coaches",
      label: "Coaches",
      value: input.coaches,
      subtitle: `${input.coachesWithoutEntry} not yet entered`,
    },
    {
      key: "entries",
      label: "Total Entries",
      value: input.entries,
      subtitle: `${input.entriesIndividual} individual / ${input.entriesGroup} group`,
    },
    {
      key: "events",
      label: "Events",
      value: input.eventTypesContested,
      subtitle: `of ${input.eventTypes} types`,
    },
    {
      key: "districts",
      label: "Districts",
      value: input.districtsWithEntries,
      subtitle: `of ${input.districtsRegistered} registered`,
    },
  ];
}
