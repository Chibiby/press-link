import { describe, expect, it } from "vitest";

import {
  auditAction,
  auditLogState,
  auditRangeLabel,
  buildAuditRows,
  type AuditEventRow,
} from "./audit-log";

function row(over: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: 12,
    at: "2026-08-23T06:14:00+00:00",
    session_id: "3f2a1c9d-1111-4111-8111-111111111111",
    school_id: "aaaaaaaa-1111-4111-8111-111111111111",
    kind: "participant-added",
    label: "Dela Cruz, Ana Mercado",
    school: { name: "Bagong Silang ES" },
    ...over,
  };
}

describe("auditLogState", () => {
  it("is ok with no error", () => {
    expect(auditLogState(null)).toBe("ok");
    expect(auditLogState(undefined)).toBe("ok");
  });

  it("reads a missing table as absent, not as a failure", () => {
    // What production answers today: 0024 and 0025 are not applied there.
    expect(
      auditLogState({
        code: "PGRST205",
        message: "Could not find the table 'public.activity_events' in the schema cache",
      })
    ).toBe("absent");
    expect(auditLogState({ code: "42P01", message: 'relation "activity_events" does not exist' })).toBe(
      "absent"
    );
    expect(auditLogState({ code: "PGRST200", message: "Could not find a relationship" })).toBe(
      "absent"
    );
  });

  it("reads a schema-cache message with no code as absent", () => {
    expect(auditLogState({ message: "Could not find the table in the schema cache" })).toBe("absent");
  });

  it("reads anything else as a failure rather than hiding it", () => {
    expect(auditLogState({ code: "42501", message: "permission denied for table activity_events" })).toBe(
      "failed"
    );
    expect(auditLogState({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(
      "failed"
    );
    expect(auditLogState({ message: "fetch failed" })).toBe("failed");
  });
});

describe("auditAction", () => {
  it("words the nine kinds without repeating the school", () => {
    expect(auditAction("participant-added")).toBe("Learner added");
    expect(auditAction("entry-withdrawn")).toBe("Entry withdrawn");
    expect(auditAction("paper-answered")).toBe("School paper question answered");
    expect(auditAction("submission-locked")).toBe("Submissions locked");
  });

  it("prints an unrecognised kind raw rather than hiding the row", () => {
    expect(auditAction("admin-unlocked-paper")).toBe("admin-unlocked-paper");
  });
});

describe("buildAuditRows", () => {
  it("splits the instant into a Manila time and day", () => {
    // 22:30Z on the 22nd is 06:30 the next morning in Manila.
    const [built] = buildAuditRows([row({ at: "2026-08-22T22:30:00+00:00" })]);
    expect(built.time).toBe("6:30 AM");
    expect(built.day).toBe("Aug 23, 2026");
  });

  it("shortens the session id and keeps the row's own detail", () => {
    const [built] = buildAuditRows([row()]);
    expect(built.session).toBe("#3f2a1c9d");
    expect(built.detail).toBe("Dela Cruz, Ana Mercado");
    expect(built.school).toBe("Bagong Silang ES");
    expect(built.action).toBe("Learner added");
    expect(built.id).toBe("12");
  });

  it("marks a write that carried no session claim", () => {
    expect(buildAuditRows([row({ session_id: null })])[0].session).toBeNull();
    expect(buildAuditRows([row({ session_id: "   " })])[0].session).toBeNull();
  });

  it("falls back rather than printing a blank school or a blank detail", () => {
    const [built] = buildAuditRows([row({ school: null, label: "   " })]);
    expect(built.school).toBe("Not recorded");
    expect(built.detail).toBeNull();
    expect(buildAuditRows([row({ school: { name: null } })])[0].school).toBe("Not recorded");
  });

  it("drops a row whose timestamp cannot be read", () => {
    expect(buildAuditRows([row({ at: "" }), row({ id: 13 })]).map((r) => r.id)).toEqual(["13"]);
  });

  it("returns nothing for nothing", () => {
    expect(buildAuditRows([])).toEqual([]);
  });
});

describe("auditRangeLabel", () => {
  it("says so when the list is complete", () => {
    expect(auditRangeLabel(4, 4)).toBe("Showing all 4 recorded actions.");
    expect(auditRangeLabel(1, 1)).toBe("Showing the only recorded action.");
  });

  it("names the total it is a slice of", () => {
    expect(auditRangeLabel(100, 4213)).toBe("Showing the newest 100 actions of 4,213 recorded.");
  });

  it("claims no total when the count header did not come back", () => {
    expect(auditRangeLabel(100, null)).toBe("Showing the newest 100 actions.");
  });

  it("has its own sentence for an empty log", () => {
    expect(auditRangeLabel(0, 0)).toBe("No actions recorded yet.");
    expect(auditRangeLabel(0, null)).toBe("No actions recorded yet.");
  });
});
