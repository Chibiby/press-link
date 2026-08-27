import { cache } from "react";

import { requireAdmin } from "@/app/admin/guard";
import type { JudgeRosterRow } from "@/components/admin/judging/JudgeRosterTable";
import {
  LANGUAGE_LABEL,
  type EventCategory,
  type EventLanguage,
  type EventLevel,
} from "@/lib/events-catalog";
import { contestUnits, unitKeyOf, type RawContestEntry } from "@/lib/judging/codes";
import {
  buildEventIndex,
  type EventIndexRow,
  type EventJudgingFacts,
  type RawIndexEvent,
} from "@/lib/judging/event-index";
import { ROUND1_SEAT, ROUND2_SEATS } from "@/lib/judging/sheet-state";
import {
  attachIdentities,
  schoolPaperForEvent,
  UNIDENTIFIED,
  type SchoolPaperRow,
} from "@/lib/judging/tabulation";
import type {
  EventRoundState,
  JudgeRank,
  TabulationRow,
  UnitIdentity,
} from "@/lib/judging/types";
import { distinctCoaches } from "@/lib/roster/entry-coaches";
import { surnameFirst } from "@/lib/roster/names";
import { isIntegratedName } from "@/lib/schools/integrated";
import { fetchAll, LoadFailure } from "@/lib/supabase/fetch-all";

/**
 * `lib/events-catalog.ts` exports `levelTag()` — "elem" / "sec", for building event
 * codes — but no prose label. `dashboard-data.ts` owns a private one for the same
 * reason this file does: the catalog stays the single source of truth for event
 * data, and a full-word label is presentation.
 *
 * The compact "Elem · Eng" form belongs to the index tables and lives in
 * `eventSlotLabel`; this longer form is for a detail page's heading, where there
 * is room and no column to line up with.
 */
const LEVEL_LABEL: Record<EventLevel, string> = {
  elementary: "Elementary",
  secondary: "Secondary",
};

export function eventFullLabel(level: EventLevel, language: EventLanguage): string {
  return `${LEVEL_LABEL[level]} · ${LANGUAGE_LABEL[language]}`;
}

interface RawEventRow {
  id: string;
  level: EventLevel;
  language: EventLanguage;
  /** `not null default 10` since migration 0018, so this is always a real choice. */
  round2_cut: number;
  event_types: {
    name_en: string;
    name_fil: string;
    category: EventCategory;
    sort_order: number;
  } | null;
  entries: { count: number }[];
}

interface RawJudgeRow {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  email: string | null;
  affiliation: string | null;
  is_active: boolean;
  /**
   * Read but never rendered. The roster shows *whether* a judge can sign in, not
   * which account they sign in as: the id is of no use to an admin and putting it
   * on a page only invites someone to quote it into a support thread.
   */
  auth_user_id: string | null;
}

interface RawAssignmentRow {
  judge_id: string;
  event_id: string;
  seat: number;
}

interface RawSheetRow {
  id: string;
  event_id: string;
  judge_id: string;
  round: number;
  submitted_at: string | null;
}

interface RawRankRow {
  sheet_id: string;
  entry_id: string;
  participant_id: string | null;
  rank: number;
}

interface RawQualifierRow {
  event_id: string;
  entry_id: string;
  participant_id: string | null;
}

interface RawRoundRow {
  event_id: string;
  round1_closed_at: string | null;
  round1_locked_at: string | null;
  round2_cut_used: number | null;
  results_locked_at: string | null;
}

/** `RawContestEntry` plus the column that says which event's unit set it belongs to. */
interface RawUnitEntryRow extends RawContestEntry {
  event_id: string;
}

export interface JudgingEventIndex {
  rows: EventIndexRow[];
  /** The judges on file, surname-first, with the number of events each sits on. */
  judges: JudgeRosterRow[];
  /**
   * Which judge holds which seat, per event id — the seating console's input.
   *
   * Kept beside `rows` rather than folded into `EventIndexRow` because a seat is an
   * administrative fact about the panel, not an input to the ranking: nothing in
   * `lib/judging` reads a seat number except to tell round 1 from round 2, and
   * `EventJudgingFacts` already carries that.
   */
  seatsByEvent: Record<string, { seat: number; judgeId: string }[]>;
  /**
   * Every submitted sheet, keyed by event — which judge filed it and on which round.
   *
   * A count of them is `sheetsSubmitted` below and answers a different question.
   * This one is per judge because it is what decides whether a seat can be emptied:
   * `admin_unassign_judge` refuses while its judge's sheet stands, and a console
   * that cannot see the sheet can only find that out by being refused.
   */
  submittedSheetsByEvent: Record<string, { judgeId: string; round: number }[]>;
  /**
   * Sheets a judge has submitted across the whole division. Submitting **is**
   * locking, so this is also the count of locked sheets — see `JudgeSheet`.
   */
  sheetsSubmitted: number;
  /**
   * Set when any of the reads failed.
   *
   * Reported rather than swallowed: empty `rows` would render "0 events" and every
   * figure above it as a zero, which claims the division runs no contests
   * (non-negotiable 5). The pages branch on this before drawing anything.
   */
  error: string | null;
}

/**
 * Every event, with its judging state, plus the judge roster.
 *
 * `cache` so the two adjudication index pages and a detail page opened from one of
 * them share a single round trip per request, the way `loadDashboardData` does.
 *
 * ## Every figure here is measured
 *
 * Migration 0018 has run, so all six judging tables are queryable and each number
 * this returns is the answer to a query. A zero now means the row is not there —
 * not that the table is not there. That distinction is the whole reason this
 * function was rewritten rather than left to fall back on `NO_JUDGING_FACTS`: the
 * pages it feeds print those numbers as facts, and the previous loader's zeros were
 * assumptions wearing the same clothes.
 *
 * ## Why the unit sets are fetched for some events and not all
 *
 * A unit set is the expensive read — every entry in an event with its participants.
 * It is fetched only for events that have judging activity, and that is a
 * correctness argument rather than a saving:
 *
 * - `consolidateRound` refuses to rank an empty panel, so with no judge assigned no
 *   unit set can change a board.
 * - `eventJudgingStatus` short-circuits to "Not started" on `judgeIds.length === 0`
 *   before it looks at a single unit.
 *
 * So for an event nobody is judging yet, the units are unobservable, and fetching
 * them would only produce a number no page can display. The moment a judge is
 * seated — an assignment, a sheet, a closed round or a drawn qualifier — the event
 * joins `activeEventIds` and its units are read in full.
 */
export const loadJudgingEventIndex = cache(async (): Promise<JudgingEventIndex> => {
  const { supabase } = await requireAdmin();

  try {
    const events = await fetchAll<RawEventRow>("The event catalog", (from, to) =>
      supabase
        .from("events")
        .select(
          "id, level, language, round2_cut, event_types(name_en, name_fil, category, sort_order), entries(count)"
        )
        .range(from, to)
        .overrideTypes<RawEventRow[]>()
    );

    const [judgeRows, assignments, sheets, ranks, qualifiers, rounds] = await Promise.all([
      fetchAll<RawJudgeRow>("The judge roster", (from, to) =>
        supabase
          .from("judges")
          .select(
            "id, first_name, middle_name, last_name, email, affiliation, is_active, auth_user_id"
          )
          .order("last_name")
          .order("first_name")
          .range(from, to)
          .overrideTypes<RawJudgeRow[]>()
      ),
      fetchAll<RawAssignmentRow>("Panel assignments", (from, to) =>
        supabase
          .from("judge_assignments")
          .select("judge_id, event_id, seat")
          .order("event_id")
          .order("seat")
          .range(from, to)
          .overrideTypes<RawAssignmentRow[]>()
      ),
      fetchAll<RawSheetRow>("Judge sheets", (from, to) =>
        supabase
          .from("judge_sheets")
          .select("id, event_id, judge_id, round, submitted_at")
          .range(from, to)
          .overrideTypes<RawSheetRow[]>()
      ),
      fetchAll<RawRankRow>("Judges' ranks", (from, to) =>
        supabase
          .from("judge_ranks")
          .select("sheet_id, entry_id, participant_id, rank")
          .range(from, to)
          .overrideTypes<RawRankRow[]>()
      ),
      fetchAll<RawQualifierRow>("Round-2 qualifiers", (from, to) =>
        supabase
          .from("round2_qualifiers")
          .select("event_id, entry_id, participant_id")
          .range(from, to)
          .overrideTypes<RawQualifierRow[]>()
      ),
      fetchAll<RawRoundRow>("Round state", (from, to) =>
        supabase
          .from("event_rounds")
          .select(
            "event_id, round1_closed_at, round1_locked_at, round2_cut_used, results_locked_at"
          )
          .range(from, to)
          .overrideTypes<RawRoundRow[]>()
      ),
    ]);

    // Ordered by seat above, so pushing in arrival order keeps each panel in seat
    // order — which is what `EventJudgingFacts.judgeIds` promises and what the
    // panel table's seat column reads back out.
    const panelByEvent = new Map<string, string[]>();
    // The same assignments keyed by their seat number, which `panelByEvent` throws
    // away. A vacant seat 3 makes the two disagree — the panel is then [2, 4] and
    // its second element is seat 4 — and the seating console has to name the seat it
    // is filling, so it cannot read positions.
    const seatsByEvent = new Map<string, { seat: number; judgeId: string }[]>();
    const eventsPerJudge = new Map<string, number>();
    // Seat 1 by its seat number, not by its position in the panel: an event
    // seated 2, 3 and 4 with seat 1 still vacant has no round 1 judge, and
    // reading the first element would put a round 2 judge in charge of the cut.
    const round1JudgeByEvent = new Map<string, string>();
    for (const row of assignments) {
      const panel = panelByEvent.get(row.event_id);
      if (panel) panel.push(row.judge_id);
      else panelByEvent.set(row.event_id, [row.judge_id]);
      const seats = seatsByEvent.get(row.event_id);
      if (seats) seats.push({ seat: row.seat, judgeId: row.judge_id });
      else seatsByEvent.set(row.event_id, [{ seat: row.seat, judgeId: row.judge_id }]);
      if (row.seat === ROUND1_SEAT) round1JudgeByEvent.set(row.event_id, row.judge_id);
      eventsPerJudge.set(row.judge_id, (eventsPerJudge.get(row.judge_id) ?? 0) + 1);
    }

    // The seat 1 judge's round 1 submission, which is what finishes round 1 (N6).
    // Keyed by event because that is how the facts are assembled below.
    const round1SubmittedByEvent = new Map<string, string>();
    // Every submitted sheet, whoever filed it. The map above answers "is round 1
    // finished" and so keeps only seat 1's; this one answers "may this seat be
    // emptied", which is asked of all four.
    const submittedByEvent = new Map<string, { judgeId: string; round: number }[]>();
    for (const sheet of sheets) {
      if (sheet.submitted_at === null) continue;
      const filed = submittedByEvent.get(sheet.event_id);
      if (filed) filed.push({ judgeId: sheet.judge_id, round: sheet.round });
      else submittedByEvent.set(sheet.event_id, [{ judgeId: sheet.judge_id, round: sheet.round }]);
      if (sheet.round !== 1) continue;
      if (round1JudgeByEvent.get(sheet.event_id) !== sheet.judge_id) continue;
      round1SubmittedByEvent.set(sheet.event_id, sheet.submitted_at);
    }

    // A rank does not carry its event, judge or round — it carries a sheet, and the
    // sheet carries all three. Resolved through this map rather than a PostgREST
    // embed so `judge_ranks` can be paged on its own: an embedded parent would
    // repeat the sheet on every rank row and put the page ceiling on the join
    // instead of on the ranks.
    const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));

    /**
     * Keyed `eventId:round`. The round comes from the sheet as-is, so a value
     * outside 1–2 — which the table's check constraint does not allow — would land
     * in a bucket nothing reads rather than being coerced into round 1 and counted
     * against the wrong board.
     */
    const ranksByEventRound = new Map<string, JudgeRank[]>();
    for (const rank of ranks) {
      const sheet = sheetsById.get(rank.sheet_id);
      // The FK makes this unreachable within one snapshot; across the two separate
      // reads above, a sheet started between them shows up as ranks with no sheet.
      // Dropping them renders the board as it stood a moment earlier, which is a
      // real earlier state rather than a wrong current one, and the next render
      // picks the sheet up.
      if (!sheet) continue;

      const key = `${sheet.event_id}:${sheet.round}`;
      const entry: JudgeRank = {
        judgeId: sheet.judge_id,
        unitKey: unitKeyOf(rank.entry_id, rank.participant_id),
        rank: rank.rank,
      };

      const bucket = ranksByEventRound.get(key);
      if (bucket) bucket.push(entry);
      else ranksByEventRound.set(key, [entry]);
    }

    const qualifiersByEvent = new Map<string, RawQualifierRow[]>();
    for (const row of qualifiers) {
      const bucket = qualifiersByEvent.get(row.event_id);
      if (bucket) bucket.push(row);
      else qualifiersByEvent.set(row.event_id, [row]);
    }

    const roundsByEvent = new Map<string, EventRoundState>(
      rounds.map((row) => [
        row.event_id,
        {
          round1ClosedAt: row.round1_closed_at,
          round1LockedAt: row.round1_locked_at,
          round2CutUsed: row.round2_cut_used,
          resultsLockedAt: row.results_locked_at,
        },
      ])
    );

    // See the doc block: an event with none of these four cannot display a unit
    // count, so its entries are not read.
    const activeEventIds = new Set<string>([
      ...panelByEvent.keys(),
      ...sheets.map((sheet) => sheet.event_id),
      ...qualifiersByEvent.keys(),
      ...roundsByEvent.keys(),
    ]);

    const unitEntries = activeEventIds.size
      ? await fetchAll<RawUnitEntryRow>("Entries for the events being judged", (from, to) =>
          supabase
            .from("entries")
            .select(
              "id, event_id, entry_number, entry_participants(participants(id, participant_number))"
            )
            .in("event_id", [...activeEventIds])
            .range(from, to)
            .overrideTypes<RawUnitEntryRow[]>()
        )
      : [];

    const entriesByEvent = new Map<string, RawContestEntry[]>();
    for (const row of unitEntries) {
      const bucket = entriesByEvent.get(row.event_id);
      if (bucket) bucket.push(row);
      else entriesByEvent.set(row.event_id, [row]);
    }

    const raw: RawIndexEvent[] = [];
    const facts: Record<string, EventJudgingFacts> = {};

    for (const row of events) {
      // events.event_type_id is NOT NULL since migration 0003, so a null type here is
      // a broken key rather than an unclassified event — dropped, not printed
      // unlabelled, exactly as the events page does it.
      if (!row.event_types) continue;

      raw.push({
        eventId: row.id,
        typeNameEn: row.event_types.name_en,
        typeNameFil: row.event_types.name_fil,
        category: row.event_types.category,
        level: row.level,
        language: row.language,
        sortOrder: row.event_types.sort_order,
        entries: row.entries?.[0]?.count ?? 0,
      });

      const { units, uncoded } = contestUnits(
        row.event_types.category,
        entriesByEvent.get(row.id) ?? []
      );

      // A unit that cannot be coded is a unit missing from the board, and a board
      // short one contestant can read as finished when it is not. Both columns
      // behind this are NOT NULL, so reaching here means a broken join — worth
      // refusing to draw the page over, rather than quietly ranking a short field.
      if (uncoded.length > 0) {
        throw new LoadFailure(
          `${uncoded.length === 1 ? "A contestant" : `${uncoded.length} contestants`} in ${row.event_types.name_en} could not be given a contest code, so this event's board would be short. ${uncoded[0].reason}`
        );
      }

      const codedByKey = new Map(units.map((unit) => [unit.unitKey, unit]));

      facts[row.id] = {
        judgeIds: panelByEvent.get(row.id) ?? [],
        round1JudgeId: round1JudgeByEvent.get(row.id) ?? null,
        round1SubmittedAt: round1SubmittedByEvent.get(row.id) ?? null,
        units,
        round1Ranks: ranksByEventRound.get(`${row.id}:1`) ?? [],
        // Round 2's unit set is the qualifier list read back through round 1's codes,
        // so a unit keeps the same code in both rounds. A qualifier with no coded
        // unit would be a qualifier for a contestant no longer in the event; it
        // drops out here rather than reaching the board without a code.
        round2Units: (qualifiersByEvent.get(row.id) ?? []).flatMap((qualifier) => {
          const unit = codedByKey.get(unitKeyOf(qualifier.entry_id, qualifier.participant_id));
          return unit ? [unit] : [];
        }),
        round2Ranks: ranksByEventRound.get(`${row.id}:2`) ?? [],
        rounds:
          roundsByEvent.get(row.id) ?? {
            round1ClosedAt: null,
            round1LockedAt: null,
            round2CutUsed: null,
            resultsLockedAt: null,
          },
        // `not null default 10` in the schema, so the fallback is unreachable and
        // stands only so a read that somehow returns nothing reports "no cut on
        // file" instead of inventing the default the division happens to use.
        round2Cut: typeof row.round2_cut === "number" ? row.round2_cut : null,
      };
    }

    return {
      rows: buildEventIndex(raw, facts),
      judges: judgeRows.map((judge) => ({
        id: judge.id,
        name: surnameFirst(judge),
        firstName: judge.first_name,
        middleName: judge.middle_name,
        lastName: judge.last_name,
        affiliation: judge.affiliation,
        email: judge.email,
        events: eventsPerJudge.get(judge.id) ?? 0,
        isActive: judge.is_active,
        hasLogin: judge.auth_user_id !== null,
      })),
      seatsByEvent: Object.fromEntries(seatsByEvent),
      submittedSheetsByEvent: Object.fromEntries(submittedByEvent),
      sheetsSubmitted: sheets.filter((sheet) => sheet.submitted_at !== null).length,
      error: null,
    };
  } catch (failure) {
    if (failure instanceof LoadFailure) {
      return {
        rows: [],
        judges: [],
        seatsByEvent: {},
        submittedSheetsByEvent: {},
        sheetsSubmitted: 0,
        error: failure.message,
      };
    }
    throw failure;
  }
});

/**
 * Printed for a seated judge whose roster row could not be read.
 *
 * `judge_assignments.judge_id` references `judges.id`, so this is unreachable
 * within one snapshot — it covers a judge added between the two reads. Deliberately
 * not a dash and not a blank seat: a dash reads as "this seat is empty", which is a
 * different fact, and the panel would then be one shorter than the seat count
 * beside it. `lib/judging/tabulation` prints `UNIDENTIFIED` for the same reason.
 */
export const UNREADABLE_JUDGE = "Unidentified judge";

/** The four seats a panel has, in the order they are worked through (N1). */
export const PANEL_SEATS: readonly number[] = [ROUND1_SEAT, ...ROUND2_SEATS];

/** One seat on an event's panel, whether or not anybody is on it. */
export interface PanelSeat {
  seat: number;
  /**
   * The round this seat ranks — 1 for seat 1, 2 for the rest (N1).
   *
   * Carried rather than recomputed by every reader. It is the argument
   * `admin_unlock_judge_sheet` takes, and a console that derived it from the seat
   * number would be a second place for N1 to be written down.
   */
  round: number;
  /** The judge seated here, or `null` for a vacant seat. */
  judge: JudgeRosterRow | null;
  /**
   * Whether this seat's judge has submitted their sheet for this seat's round.
   *
   * Submitting is locking (see `JudgeSheet`), so this is also what stops the seat
   * being emptied: `admin_unassign_judge` refuses while the sheet stands, because
   * an empty seat whose ranks are still on file could place a contestant on the
   * opinion of somebody no longer on the panel.
   */
  sheetSubmitted: boolean;
}

/**
 * One event's index row and the panel seated on it, for a detail page.
 *
 * Served from {@link loadJudgingEventIndex} rather than its own query so a detail
 * page cannot show a different status from the row that linked to it — and, since
 * the loader is `cache`d, so opening a detail page costs no extra round trip. The
 * catalog is a few dozen rows; a dedicated single-row query would buy nothing and
 * would be a second place for the join to drift.
 *
 * `seats` is the panel as the seating console needs it — all four, vacant ones
 * included — and `judgeNames` is the seated subset keyed for `BoardTable`, which
 * labels each rank column with the judge who filed it. Both are shaped here so the
 * page does no joining of its own.
 */
export const loadJudgingEvent = cache(
  async (
    eventId: string
  ): Promise<{
    row: EventIndexRow | null;
    /** All four seats in seat order, the vacant ones included — the seating console's input. */
    seats: PanelSeat[];
    /** Every judge on file, so the seat picker has a roster to choose from. */
    roster: JudgeRosterRow[];
    judgeNames: Record<string, string>;
    error: string | null;
  }> => {
    const { rows, judges, seatsByEvent, submittedSheetsByEvent, error } =
      await loadJudgingEventIndex();
    const nothing = { row: null, seats: [], roster: [], judgeNames: {} };
    if (error) return { ...nothing, error };

    const row = rows.find((candidate) => candidate.eventId === eventId) ?? null;
    if (!row) return { ...nothing, error: null };

    const rosterById = new Map(judges.map((judge) => [judge.id, judge]));
    /** A seated judge whose roster row could not be read — see {@link UNREADABLE_JUDGE}. */
    const unreadable = (judgeId: string): JudgeRosterRow => ({
      id: judgeId,
      name: UNREADABLE_JUDGE,
      // Blank rather than the constant repeated into them: these three feed the edit
      // form, and this row is one whose real names could not be read. A form seeded
      // with "Unidentified judge" in the first-name box would save that as a name.
      firstName: "",
      middleName: null,
      lastName: "",
      affiliation: null,
      email: null,
      events: 0,
      isActive: false,
      hasLogin: false,
    });

    // Driven off the board's `judgeIds` rather than by filtering the roster: that
    // array is in seat order, and a roster filter would come back in roster order
    // and quietly relabel every seat. Local, because the only thing anybody wanted
    // from it was `judgeNames` — the console below needs the vacancies too.
    const seated = row.round1.judgeIds.map(
      (judgeId): JudgeRosterRow => rosterById.get(judgeId) ?? unreadable(judgeId)
    );

    // Every seat, not only the taken ones. The console's job is to fill seat 3 while
    // 1 and 2 are occupied, and a list of who is seated cannot say which seat is
    // free — `panel` above is exactly that list, which is why it is not enough here.
    // Drawn from `PANEL_SEATS` so the four rows come out in the order the rounds are
    // worked through, whatever order the assignment rows arrived in.
    const bySeat = new Map((seatsByEvent[eventId] ?? []).map((held) => [held.seat, held.judgeId]));
    const filed = new Set(
      (submittedSheetsByEvent[eventId] ?? []).map((sheet) => `${sheet.judgeId}:${sheet.round}`)
    );
    const seats = PANEL_SEATS.map((seat): PanelSeat => {
      const judgeId = bySeat.get(seat);
      const round = seat === ROUND1_SEAT ? 1 : 2;
      return {
        seat,
        round,
        judge: judgeId === undefined ? null : (rosterById.get(judgeId) ?? unreadable(judgeId)),
        // Keyed on the seat's own round, not on any sheet the judge has filed here:
        // a judge holds one seat per event, so the two agree — but reading "has a
        // sheet" rather than "has this round's sheet" would let a stale round 1
        // submission lock a seat that had since been moved to round 2.
        sheetSubmitted: judgeId !== undefined && filed.has(`${judgeId}:${round}`),
      };
    });

    return {
      row,
      seats,
      roster: judges,
      judgeNames: Object.fromEntries(seated.map((judge) => [judge.id, judge.name])),
      error: null,
    };
  }
);

/** One entry with everything the identified side of an event's sheet prints. */
interface RawIdentityEntryRow {
  id: string;
  schools: {
    name: string;
    districts: { name: string } | null;
    school_papers: SchoolPaperRow[] | null;
  } | null;
  entry_participants:
    | { participants: { id: string; first_name: string; middle_name: string | null; last_name: string } | null }[]
    | null;
  entry_coaches:
    | {
        coaches: {
          id: string;
          first_name: string;
          middle_name: string | null;
          last_name: string;
        } | null;
      }[]
    | null;
}

export interface EventSheet {
  row: EventIndexRow | null;
  /** The sheet, in placement order. Empty when nothing has been ranked. */
  rows: TabulationRow[];
  /**
   * Contest codes whose identity could not be joined. Their ranks are still on the
   * sheet — see {@link attachIdentities} for why they are kept rather than dropped.
   */
  unidentified: string[];
  error: string | null;
}

/**
 * One event's **identified** results sheet: the standings joined back to names,
 * coaches, schools, districts and papers.
 *
 * This is the identified side of the wall, and the only loader that crosses it. The
 * anonymous boards a judge sees are built by {@link loadJudgingEvent} and never come
 * near this query; the join itself is `attachIdentities`, which lives in
 * `lib/judging/tabulation` for exactly that reason (non-negotiable 1).
 *
 * ## Why the identities are read for one event and not all of them
 *
 * Unlike the index's unit sets, this read carries names, coaches and papers — the
 * whole identified side of every entry. It is scoped to the one event a tabulator
 * opened, because that is the only event whose sheet is on screen, and reading the
 * division's roster to draw one contest's sheet would put every school's data in a
 * response that needs one school's.
 *
 * ## What a missing identity does
 *
 * Nothing here fabricates one. An entry whose school could not be read emits no
 * identity at all, so `attachIdentities` reports its codes in `unidentified` and
 * prints them on the sheet as such — one path for the fault instead of two. A
 * district that cannot be read is narrower: the school is still known, so it is
 * still printed, and only the district cell says so.
 */
export const loadEventSheet = cache(async (eventId: string): Promise<EventSheet> => {
  const { row, error } = await loadJudgingEvent(eventId);
  if (error || !row) return { row: null, rows: [], unidentified: [], error };

  // No cut means no field to divide, so there are no standings to identify. The row
  // still comes back: the page prints the event and says why the sheet is blank
  // rather than showing an empty one as though nobody had been ranked.
  if (row.standings === null) return { row, rows: [], unidentified: [], error: null };
  if (row.standings.length === 0) return { row, rows: [], unidentified: [], error: null };

  const { supabase } = await requireAdmin();

  try {
    const entries = await fetchAll<RawIdentityEntryRow>(
      "The contestants on this event's sheet",
      (from, to) =>
        supabase
          .from("entries")
          .select(
            "id, schools(name, districts(name), school_papers(language, level, paper_name)), entry_participants(participants(id, first_name, middle_name, last_name)), entry_coaches(coaches(id, first_name, middle_name, last_name))"
          )
          .eq("event_id", eventId)
          .range(from, to)
          .overrideTypes<RawIdentityEntryRow[]>()
    );

    const identities: UnitIdentity[] = [];

    for (const entry of entries) {
      // See the doc block: no school, no identity — the join failure is reported
      // once, by the function whose job that is.
      if (!entry.schools) continue;

      const school = entry.schools;
      const shared = {
        coaches: distinctCoaches(entry.entry_coaches).map(surnameFirst),
        // The event's level and language pick the paper, not the school's — an
        // integrated school files one per level and a secondary contestant is
        // credited to the secondary paper. `schoolPaperForEvent` holds that rule.
        schoolPaper: schoolPaperForEvent(
          school.school_papers ?? [],
          { level: row.level, language: row.language },
          isIntegratedName(school.name)
        ),
        schoolName: school.name,
        // `schools.district_id` is NOT NULL, so this covers a district row added
        // between reads. The school is a fact we have; only the district is not.
        districtName: school.districts?.name ?? UNIDENTIFIED,
      };

      if (row.category === "group") {
        identities.push({ unitKey: unitKeyOf(entry.id, null), name: null, ...shared });
        continue;
      }

      for (const link of entry.entry_participants ?? []) {
        if (!link.participants) continue;
        identities.push({
          unitKey: unitKeyOf(entry.id, link.participants.id),
          name: surnameFirst(link.participants),
          ...shared,
        });
      }
    }

    const { rows, unidentified } = attachIdentities(row.standings, identities);
    return { row, rows, unidentified, error: null };
  } catch (failure) {
    if (failure instanceof LoadFailure) {
      return { row, rows: [], unidentified: [], error: failure.message };
    }
    throw failure;
  }
});
