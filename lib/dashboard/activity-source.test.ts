import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchActivity } from "./activity-source";
import type { SupabaseServerClient } from "../supabase/server";

/**
 * The point of these tests is the failure path, not the happy one.
 *
 * Migrations 0024 and 0025 are not applied on the database this branch deploys to,
 * so `fetchActivity` has to answer with today's six-source feed when
 * `recent_activity_sessions()`, `activity_events` or
 * `app_settings.activity_log_started_at` is not there — and the codes an unmigrated
 * Supabase project actually returns come from its schema cache (`PGRST2xx`), not
 * from Postgres. Those are asserted here by code, because a regression would be
 * invisible in review and total in production: the admin loses the activity panel.
 *
 * The client is faked rather than the module mocked, so the assertions can be about
 * the queries themselves — that the probe is asked for `limit` and not `limit + 1`,
 * and that the legacy gate is applied to all six columns or to none.
 */

interface QueryResult {
  data: unknown;
  error: { code: string; message: string } | null;
}

/** One `from()` chain, as the fake recorded it. */
interface RecordedQuery {
  table: string;
  columns: string;
  filters: string[];
  limit: number | null;
}

interface FakeQuery extends PromiseLike<QueryResult> {
  select(columns: string): FakeQuery;
  not(column: string, operator: string, value: unknown): FakeQuery;
  eq(column: string, value: unknown): FakeQuery;
  is(column: string, value: unknown): FakeQuery;
  lt(column: string, value: string): FakeQuery;
  order(column: string, options?: { ascending?: boolean }): FakeQuery;
  limit(count: number): FakeQuery;
  maybeSingle(): FakeQuery;
  overrideTypes(): FakeQuery;
}

const CUTOFF = "2026-06-01T00:00:00+00:00";

const MISSING_TABLE = { code: "PGRST205", message: "Could not find the table in the schema cache" };
const MISSING_FUNCTION = { code: "PGRST202", message: "Could not find the function" };
const MISSING_COLUMN = { code: "PGRST204", message: "Could not find the column" };

/** One pre-cutoff row per legacy source, so all six are visibly represented. */
const LEGACY_ROWS: Record<string, unknown[]> = {
  entries: [
    {
      id: "e1",
      submitted_at: "2026-05-01T01:00:00+00:00",
      school_id: "s1",
      schools: { name: "Alpha ES" },
      events: { name: "Editorial Writing" },
    },
  ],
  participants: [
    {
      id: "p1",
      participant_number: 7,
      first_name: "Ana",
      middle_name: null,
      last_name: "Cruz",
      created_at: "2026-05-01T02:00:00+00:00",
      school_id: "s1",
      schools: { name: "Alpha ES" },
    },
  ],
  coaches: [
    {
      id: "c1",
      first_name: "Ben",
      middle_name: null,
      last_name: "Diaz",
      created_at: "2026-05-01T03:00:00+00:00",
      schools: { name: "Alpha ES" },
    },
  ],
  paperAnswers: [
    {
      id: "s1",
      name: "Alpha ES",
      paper_participation: "yes",
      paper_answered_at: "2026-05-01T04:00:00+00:00",
    },
  ],
  locks: [{ id: "s2", name: "Beta ES", submission_locked_at: "2026-05-01T05:00:00+00:00" }],
  school_papers: [
    {
      id: "sp1",
      paper_name: "The Torch",
      updated_at: "2026-05-01T06:00:00+00:00",
      schools: { name: "Alpha ES" },
    },
  ],
};

const LEGACY_COUNT = Object.keys(LEGACY_ROWS).length;

function legacyKey(table: string, columns: string): string | null {
  if (table === "schools") {
    return columns.includes("paper_answered_at") ? "paperAnswers" : "locks";
  }
  return table in LEGACY_ROWS ? table : null;
}

function event(id: string, sessionId: string | null, at: string, kind = "participant-added") {
  return {
    id,
    at,
    session_id: sessionId,
    school_id: "s1",
    kind,
    label: `Learner ${id}`,
    schools: { name: "Alpha ES" },
  };
}

interface Fixture {
  /** `recent_activity_sessions()`. Missing function unless a test says otherwise. */
  probe?: QueryResult;
  /** `app_settings.activity_log_started_at`. Missing column unless a test says otherwise. */
  cutoff?: QueryResult;
  /** `activity_events` where `session_id is null`. */
  ungrouped?: QueryResult;
  /** `activity_events` per session id. */
  sessionEvents?: Record<string, QueryResult>;
  /** Applied to every `activity_events` read, for the whole-table failures. */
  eventsError?: { code: string; message: string };
  legacy?: Record<string, unknown[]>;
}

function fakeClient(fixture: Fixture) {
  const queries: RecordedQuery[] = [];
  const rpcCalls: { name: string; args: unknown }[] = [];

  function respond(query: RecordedQuery): QueryResult {
    if (query.table === "app_settings") {
      return fixture.cutoff ?? { data: null, error: MISSING_COLUMN };
    }

    if (query.table === "activity_events") {
      if (fixture.eventsError) return { data: null, error: fixture.eventsError };
      if (query.filters.includes("is:session_id:null")) {
        return fixture.ungrouped ?? { data: [], error: null };
      }
      const id = query.filters
        .find((filter) => filter.startsWith("eq:session_id:"))
        ?.replace("eq:session_id:", "");
      return fixture.sessionEvents?.[id ?? ""] ?? { data: [], error: null };
    }

    const key = legacyKey(query.table, query.columns);
    if (key === null) throw new Error(`unexpected table read: ${query.table}`);
    return { data: (fixture.legacy ?? LEGACY_ROWS)[key] ?? [], error: null };
  }

  function makeQuery(table: string): FakeQuery {
    const record: RecordedQuery = { table, columns: "", filters: [], limit: null };
    queries.push(record);

    const query: FakeQuery = {
      select: (columns) => {
        record.columns = columns;
        return query;
      },
      not: () => query,
      eq: (column, value) => {
        record.filters.push(`eq:${column}:${String(value)}`);
        return query;
      },
      is: (column, value) => {
        record.filters.push(`is:${column}:${String(value)}`);
        return query;
      },
      lt: (column, value) => {
        record.filters.push(`lt:${column}:${value}`);
        return query;
      },
      order: () => query,
      limit: (count) => {
        record.limit = count;
        return query;
      },
      maybeSingle: () => query,
      overrideTypes: () => query,
      then: (onFulfilled, onRejected) =>
        Promise.resolve(respond(record)).then(onFulfilled, onRejected),
    };

    return query;
  }

  const client = {
    from: (table: string) => makeQuery(table),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(fixture.probe ?? { data: null, error: MISSING_FUNCTION });
    },
  };

  return { supabase: client as unknown as SupabaseServerClient, queries, rpcCalls };
}

function gateFilters(queries: RecordedQuery[]): string[] {
  return queries.flatMap((query) => query.filters.filter((filter) => filter.startsWith("lt:")));
}

describe("fetchActivity on a database without migrations 0024 and 0025", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the six legacy sources, ungated, when nothing new exists", async () => {
    const { supabase, queries } = fakeClient({});

    const feed = await fetchActivity(supabase, 10);

    expect(feed.items).toHaveLength(LEGACY_COUNT);
    // Ungated: a cutoff nobody can read must not filter `at < null` and empty the panel.
    expect(gateFilters(queries)).toEqual([]);
    // The probe failed, so no event read was attempted at all.
    expect(queries.filter((query) => query.table === "activity_events")).toEqual([]);
  });

  it("stays silent about the absent objects instead of logging once per render", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase } = fakeClient({});

    await fetchActivity(supabase, 10);

    expect(logged).not.toHaveBeenCalled();
  });

  it("logs, and still degrades, when the failure is not a missing object", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { supabase, queries } = fakeClient({
      probe: { data: null, error: { code: "42501", message: "permission denied" } },
    });

    const feed = await fetchActivity(supabase, 10);

    expect(logged).toHaveBeenCalled();
    expect(feed.items).toHaveLength(LEGACY_COUNT);
    expect(gateFilters(queries)).toEqual([]);
  });

  it("does not gate the legacy sources when the cutoff reads but the events do not", async () => {
    const { supabase, queries } = fakeClient({
      probe: { data: [{ session_id: "sess-1", last_at: "2026-08-20T01:00:00+00:00" }], error: null },
      cutoff: { data: { activity_log_started_at: CUTOFF }, error: null },
      eventsError: MISSING_TABLE,
    });

    const feed = await fetchActivity(supabase, 10);

    // Half a migration is the trap: gating here would drop every action since the
    // cutoff from both halves of the feed.
    expect(gateFilters(queries)).toEqual([]);
    expect(feed.items).toHaveLength(LEGACY_COUNT);
  });

  it("does not gate when the settings row exists with a null cutoff", async () => {
    const { supabase, queries } = fakeClient({
      probe: { data: [], error: null },
      cutoff: { data: { activity_log_started_at: null }, error: null },
    });

    await fetchActivity(supabase, 10);

    expect(gateFilters(queries)).toEqual([]);
  });
});

describe("fetchActivity once the event log exists", () => {
  it("asks the probe for limit, not limit + 1, and reads only the newest sessions", async () => {
    const { supabase, queries, rpcCalls } = fakeClient({
      probe: {
        data: [
          { session_id: "old", last_at: "2026-08-18T01:00:00+00:00" },
          { session_id: "newest", last_at: "2026-08-20T01:00:00+00:00" },
          { session_id: "middle", last_at: "2026-08-19T01:00:00+00:00" },
        ],
        error: null,
      },
      cutoff: { data: { activity_log_started_at: CUTOFF }, error: null },
      sessionEvents: {
        newest: {
          data: [
            event("v1", "newest", "2026-08-20T01:00:00+00:00"),
            event("v2", "newest", "2026-08-20T01:05:00+00:00", "coach-added"),
          ],
          error: null,
        },
        middle: { data: [event("v3", "middle", "2026-08-19T01:00:00+00:00")], error: null },
      },
    });

    const feed = await fetchActivity(supabase, 2);

    // The RPC returns limit + 1 rows itself; adding one here would read a session
    // the feed cannot show and report truncation that is not there.
    expect(rpcCalls).toEqual([{ name: "recent_activity_sessions", args: { p_limit: 2 } }]);

    const readIds = queries
      .filter((query) => query.table === "activity_events")
      .flatMap((query) => query.filters.filter((filter) => filter.startsWith("eq:session_id:")));
    expect(readIds).toEqual(["eq:session_id:newest", "eq:session_id:middle"]);

    expect(feed.items.map((item) => item.id)).toEqual(["session:newest", "session:middle"]);
    // Three sessions probed against a limit of two: one was left out.
    expect(feed.truncated).toBe(true);
  });

  it("reads a session's events whole, capped at 500, and reports the cap", async () => {
    const rows = Array.from({ length: 500 }, (_, index) =>
      event(`v${index}`, "busy", `2026-08-20T01:00:00+00:00`)
    );
    const { supabase, queries } = fakeClient({
      probe: { data: [{ session_id: "busy", last_at: "2026-08-20T01:00:00+00:00" }], error: null },
      cutoff: { data: { activity_log_started_at: CUTOFF }, error: null },
      sessionEvents: { busy: { data: rows, error: null } },
      legacy: {},
    });

    const feed = await fetchActivity(supabase, 5);

    const perSession = queries.find((query) =>
      query.filters.includes("eq:session_id:busy")
    );
    // Not the feed's limit: a session read five rows deep would say "added 5
    // learners" for a session that added 500.
    expect(perSession?.limit).toBe(500);
    // One session, well inside the limit, so only the cap can be saying this.
    expect(feed.truncated).toBe(true);
  });

  it("gates all six legacy sources on the cutoff", async () => {
    const { supabase, queries } = fakeClient({
      probe: { data: [], error: null },
      cutoff: { data: { activity_log_started_at: CUTOFF }, error: null },
    });

    await fetchActivity(supabase, 10);

    expect(gateFilters(queries).sort()).toEqual(
      [
        `lt:created_at:${CUTOFF}`,
        `lt:created_at:${CUTOFF}`,
        `lt:paper_answered_at:${CUTOFF}`,
        `lt:submission_locked_at:${CUTOFF}`,
        `lt:submitted_at:${CUTOFF}`,
        `lt:updated_at:${CUTOFF}`,
      ].sort()
    );
  });

  it("still shows events that carry no session id at all", async () => {
    // `activity_events.session_id` comes from a JWT claim this project does not
    // set. Then the probe returns nothing, and these rows are the only record of
    // everything that happened since the cutoff.
    const { supabase, queries } = fakeClient({
      probe: { data: [], error: null },
      cutoff: { data: { activity_log_started_at: CUTOFF }, error: null },
      ungrouped: {
        data: [
          event("u1", null, "2026-08-20T01:00:00+00:00"),
          event("u2", null, "2026-08-19T01:00:00+00:00", "entry-submitted"),
        ],
        error: null,
      },
      legacy: {},
    });

    const feed = await fetchActivity(supabase, 10);

    expect(feed.items.map((item) => item.id)).toEqual([
      "participant-added:u1",
      "entry-submitted:u2",
    ]);
    // Each becomes one item and the merge keeps `limit` of them, so the newest
    // `limit` rows are every row that could survive it.
    expect(queries.find((query) => query.filters.includes("is:session_id:null"))?.limit).toBe(10);
  });

  it("keeps the pre-cutoff history alongside the sessions", async () => {
    const { supabase } = fakeClient({
      probe: { data: [{ session_id: "sess-1", last_at: "2026-08-20T01:00:00+00:00" }], error: null },
      cutoff: { data: { activity_log_started_at: CUTOFF }, error: null },
      sessionEvents: {
        "sess-1": { data: [event("v1", "sess-1", "2026-08-20T01:00:00+00:00")], error: null },
      },
    });

    const feed = await fetchActivity(supabase, 10);

    expect(feed.items).toHaveLength(LEGACY_COUNT + 1);
    expect(feed.items[0].id).toBe("session:sess-1");
  });
});
