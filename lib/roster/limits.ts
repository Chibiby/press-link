import type { EventCategory } from "@/lib/events-catalog";

/** A participant may compete in at most this many individual contests. */
export const INDIVIDUAL_EVENT_CAP = 2;
/** ...and at most this many group contests. */
export const GROUP_EVENT_CAP = 1;

/** How many entries a participant already appears in, split by category. */
export interface ParticipantUsage {
  individualCount: number;
  groupCount: number;
}

/** Keyed by participant id. Absent means the participant has no entries yet. */
export type UsageMap = Record<string, ParticipantUsage>;

export function formatParticipantNumber(value: number): string {
  return String(value).padStart(4, "0");
}

/**
 * Why this participant cannot join another entry of `category`, or null when
 * they still can. The string is shown next to the disabled option.
 */
export function capReason(
  usage: ParticipantUsage | undefined,
  category: EventCategory
): string | null {
  if (!usage) return null;
  if (category === "individual") {
    return usage.individualCount >= INDIVIDUAL_EVENT_CAP
      ? `Already in ${INDIVIDUAL_EVENT_CAP} individual events`
      : null;
  }
  return usage.groupCount >= GROUP_EVENT_CAP ? "Already in a group event" : null;
}

/**
 * One coach on an entry, and the contestant they are for.
 *
 * `participantId` is null when the coach is not paired with anyone. That is the
 * permanent state of a group entry's coaches, who are shared by the whole team,
 * and the pending state of an individual entry filed before migration 0019 gave
 * `entry_coaches` a contestant to point at.
 */
export interface EntryCoach {
  coachId: string;
  participantId: string | null;
}

/**
 * An individual entry names one coach per contestant, so the most coaches it can
 * hold is the most contestants a contest allows — three, in every individual
 * event in the catalog.
 */
export const INDIVIDUAL_COACH_CAP = 3;
/** A group entry gets two coaches no matter how large the team. */
export const GROUP_COACH_CAP = 2;

export function maxCoachesFor(category: EventCategory): number {
  return category === "individual" ? INDIVIDUAL_COACH_CAP : GROUP_COACH_CAP;
}

export function validateEntryCounts(input: {
  category: EventCategory;
  participantIds: string[];
  coaches: EntryCoach[];
  minParticipants: number;
  maxParticipants: number | null;
}): string | null {
  const { category, participantIds, coaches, minParticipants, maxParticipants } = input;

  if (new Set(participantIds).size !== participantIds.length) {
    return "The same participant cannot be added twice";
  }
  if (participantIds.length < minParticipants) {
    return `This event requires at least ${minParticipants} participant${
      minParticipants === 1 ? "" : "s"
    }`;
  }
  if (maxParticipants !== null && participantIds.length > maxParticipants) {
    return `This event allows at most ${maxParticipants} participant${
      maxParticipants === 1 ? "" : "s"
    }`;
  }
  if (coaches.length < 1) {
    return "At least 1 coach is required";
  }

  return category === "individual"
    ? individualCoachError(participantIds, coaches)
    : groupCoachError(coaches);
}

/**
 * An individual entry is a set of pairs: every contestant has a coach, and no
 * contestant has two. Both halves are checked here rather than in the database,
 * because both need the entry's event category — a join a CHECK constraint
 * cannot make. See migration 0019, section 5.
 *
 * One coach may hold several of these pairs. A small school sending three
 * contestants under one adviser is the ordinary case, not an error, so duplicate
 * coach ids are deliberately not rejected.
 */
function individualCoachError(participantIds: string[], coaches: EntryCoach[]): string | null {
  const coached = new Set<string>();
  for (const { participantId } of coaches) {
    if (participantId === null) {
      return "Choose which contestant each coach is for";
    }
    if (!participantIds.includes(participantId)) {
      return "A coach was matched to someone who is not in this entry";
    }
    if (coached.has(participantId)) {
      return "A contestant can have only 1 coach";
    }
    coached.add(participantId);
  }
  if (coached.size < participantIds.length) {
    return "Choose a coach for every contestant";
  }
  return null;
}

/** A team shares its coaches, so none of them is paired and none is named twice. */
function groupCoachError(coaches: EntryCoach[]): string | null {
  if (coaches.some((coach) => coach.participantId !== null)) {
    return "A group entry's coaches are shared by the team, not matched to one member";
  }
  const coachIds = coaches.map((coach) => coach.coachId);
  if (new Set(coachIds).size !== coachIds.length) {
    return "The same coach cannot be added twice";
  }
  if (coaches.length > GROUP_COACH_CAP) {
    return `This entry allows at most ${GROUP_COACH_CAP} coaches`;
  }
  return null;
}
