import type { EventCategory } from "@/lib/events-catalog";

import type { ContestUnit } from "./types";

/**
 * The anonymous code a judge sees, and the identity everything else joins on.
 *
 * Four digits, zero-padded, the same convention as
 * `formatParticipantNumber` in `lib/roster/limits.ts` — because for an
 * individual event it *is* the participant number, and a contestant whose badge
 * reads `0042` must not appear on a judge's sheet as `42`.
 *
 * Migration 0018 computes the same string in SQL as
 * `lpad(participant_number::text, 4, '0')`, because `judge_event_units` has to
 * return codes without returning anything else. **The two must agree.** If this
 * padding ever changes, that RPC changes in the same commit, or the judge portal
 * and the tabulators' sheet will disagree about which contestant is which.
 */
export function formatContestCode(value: number): string {
  return String(value).padStart(4, "0");
}

/**
 * The string identity of a contest unit.
 *
 * `participantId` when there is one, otherwise `entryId`.
 *
 * It cannot be `entryId` alone. An individual event carries up to three
 * contestants on one school's entry and **each is ranked separately** (spec §2),
 * so keying on the entry would collapse three placements into one and a judge's
 * three ranks would overwrite each other. It cannot be `participantId` alone
 * either, because a group event has no participant — the team is the unit.
 *
 * Migration 0018 spells this as `coalesce(participant_id::text, entry_id::text)`
 * inside `judge_event_units`. Same rule, two engines; they must agree.
 */
export function unitKeyOf(entryId: string, participantId: string | null): string {
  return participantId ?? entryId;
}

/** One participant on an entry, as an individual event's rows arrive. */
export interface RawEntryParticipant {
  participants: {
    id: string;
    participant_number: number | null;
  } | null;
}

/**
 * One entry as the unit builder needs it — the natural shape of a Supabase
 * select over `entries` with its participants embedded:
 *
 * ```
 * .from("entries")
 * .select("id, entry_number, entry_participants(participants(id, participant_number))")
 * .eq("event_id", eventId)
 * ```
 *
 * Exported so a page, a loader and a test all name the same shape instead of
 * three structurally-identical inline types drifting apart.
 */
export interface RawContestEntry {
  id: string;
  entry_number: number | null;
  entry_participants: RawEntryParticipant[] | null;
}

/** A unit that could not be coded, and why — see {@link contestUnits}. */
export interface UncodedUnit {
  entryId: string;
  participantId: string | null;
  reason: string;
}

export interface ContestUnitsResult {
  units: ContestUnit[];
  /**
   * Rows that could not be given a code. Never silently empty-coded: a blank
   * code on a judge's sheet is a row they cannot report a problem about, and a
   * row a rank could be attached to that no tabulator could ever identify.
   */
  uncoded: UncodedUnit[];
}

/**
 * Every unit a given event ranks, in code order.
 *
 * The category decides what a unit *is*, and that is the whole reason this
 * function takes it: an `individual` event ranks each contestant on each entry,
 * a `group` event ranks the team. An event is wholly one or wholly the other
 * (spec §2), so one 4-digit code space per event never mixes the two kinds and
 * needs no prefix.
 *
 * Missing numbers are **reported, not coded**. `participants.participant_number`
 * and `entries.entry_number` are both `not null` in the schema, so a null here
 * means a broken join or a row written before 0018's backfill — a data fault,
 * not a contestant with no number. Dropping it into `uncoded` lets an admin page
 * name the fault; emitting `"0000"` would hand a judge two indistinguishable
 * rows, and throwing would take down a whole event's sheet over one bad row.
 *
 * Sorting by `code` is a plain string compare, which is safe *because* the codes
 * are fixed-width and zero-padded — `"0042" < "0100"` lexically as well as
 * numerically. That is a second reason the padding in {@link formatContestCode}
 * is load-bearing and not cosmetic.
 */
export function contestUnits(
  category: EventCategory,
  rawEntries: RawContestEntry[]
): ContestUnitsResult {
  const units: ContestUnit[] = [];
  const uncoded: UncodedUnit[] = [];

  for (const entry of rawEntries) {
    if (category === "group") {
      if (entry.entry_number === null) {
        uncoded.push({
          entryId: entry.id,
          participantId: null,
          reason: "This entry has no entry number, so it cannot be given a contest code.",
        });
        continue;
      }
      units.push({
        unitKey: unitKeyOf(entry.id, null),
        code: formatContestCode(entry.entry_number),
        entryId: entry.id,
        participantId: null,
      });
      continue;
    }

    for (const link of entry.entry_participants ?? []) {
      const participant = link.participants;
      // A null embed is a broken foreign key, not a participant-less entry:
      // `entry_participants.participant_id` has been NOT NULL since 0004. There
      // is no id to report, so the entry carries the fault.
      if (!participant) {
        uncoded.push({
          entryId: entry.id,
          participantId: null,
          reason: "An entry row points at a participant that could not be read.",
        });
        continue;
      }
      if (participant.participant_number === null) {
        uncoded.push({
          entryId: entry.id,
          participantId: participant.id,
          reason:
            "This participant has no participant number, so they cannot be given a contest code.",
        });
        continue;
      }
      units.push({
        unitKey: unitKeyOf(entry.id, participant.id),
        code: formatContestCode(participant.participant_number),
        entryId: entry.id,
        participantId: participant.id,
      });
    }
  }

  units.sort((a, b) => a.code.localeCompare(b.code));
  return { units, uncoded };
}
