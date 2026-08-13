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
 * Individual entries get one coach per participant; group entries get two no
 * matter how large the team.
 */
export function maxCoachesFor(category: EventCategory, participantCount: number): number {
  return category === "individual" ? Math.max(participantCount, 1) : 2;
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
  const maxCoaches = maxCoachesFor(category, participantIds.length);
  if (coachIds.length > maxCoaches) {
    return `This entry allows at most ${maxCoaches} coach${maxCoaches === 1 ? "" : "es"}`;
  }
  return null;
}
