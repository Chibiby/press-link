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

/** An individual entry may name up to this many coaches. */
export const INDIVIDUAL_COACH_CAP = 3;
/** A group entry gets two coaches no matter how large the team. */
export const GROUP_COACH_CAP = 2;

/**
 * Both caps are flat: a single contestant may still be coached by up to three
 * people, and a seven-member team by two.
 */
export function maxCoachesFor(category: EventCategory): number {
  return category === "individual" ? INDIVIDUAL_COACH_CAP : GROUP_COACH_CAP;
}

export function validateEntryCounts(input: {
  category: EventCategory;
  participantIds: string[];
  coachIds: string[];
  minParticipants: number;
  maxParticipants: number | null;
}): string | null {
  const { category, participantIds, coachIds, minParticipants, maxParticipants } = input;

  if (new Set(participantIds).size !== participantIds.length) {
    return "The same participant cannot be added twice";
  }
  if (new Set(coachIds).size !== coachIds.length) {
    return "The same coach cannot be added twice";
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
  if (coachIds.length < 1) {
    return "At least 1 coach is required";
  }
  const maxCoaches = maxCoachesFor(category);
  if (coachIds.length > maxCoaches) {
    return `This entry allows at most ${maxCoaches} coach${maxCoaches === 1 ? "" : "es"}`;
  }
  return null;
}
