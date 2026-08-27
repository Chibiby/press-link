import type { ReactNode } from "react";

import { JudgingEmptyRow } from "@/components/admin/judging/EventJudgingBadge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * A judge as the admin roster lists them.
 *
 * Declared here rather than imported from `lib/judging/types` on purpose: that
 * file is the vocabulary of *ranking*, and a judge's email and affiliation are
 * not part of it. It is the row shape of the `judges` table plus `events`, which
 * is counted off `judge_assignments` rather than stored.
 *
 * `name`, `affiliation`, `email`, `events` and `isActive` are load-bearing beyond
 * this file: `lib/export/judging-workbook` declares its own `JudgeRosterExportRow`
 * with exactly those five and relies on this being assignable to it, so a route can
 * hand its loaded roster straight to the workbook builder without `lib/` importing
 * React. Adding a field here is free; renaming or dropping one of the five breaks
 * the export, and breaks it at the call site rather than here.
 */
export interface JudgeRosterRow {
  id: string;
  /** Surname-first, via `lib/roster/names`, so it sorts with the rest of the app. */
  name: string;
  /**
   * The same name unjoined, which only the edit form reads. `name` above cannot be
   * taken apart again — "Dela Cruz, Maria A." does not say which of those words is
   * the surname — so a form seeded by splitting it would quietly move a two-word
   * surname into the given names on the first correction anybody made.
   */
  firstName: string;
  middleName: string | null;
  lastName: string;
  affiliation: string | null;
  email: string | null;
  /** How many events this judge sits on. */
  events: number;
  isActive: boolean;
  /**
   * Whether `judges.auth_user_id` is set — that is, whether this judge can sign in
   * at `/judge/login`. The id itself is deliberately not carried up here: an admin
   * has no use for it, and a column that prints one invites somebody to quote it
   * into a support thread.
   *
   * A judge on file with no login is the normal state rather than a fault — 0018
   * draws a panel up in a meeting and the accounts are made afterwards.
   */
  hasLogin: boolean;
}

/**
 * What the Login column means, spelled out on hover.
 *
 * Two whole sentences rather than one clause with a negation, because the absent
 * case is the one that gets misread. It has to say both what is missing (an account,
 * not a judge) and that missing it is the ordinary order of business — the panel is
 * agreed in a meeting and the logins are made afterwards, so a roster reading "no
 * login yet" all the way down on the day the panel is drawn up is a correct roster.
 * Neither sentence is phrased as something to fix; an admin who reads either should
 * not go looking for a broken row.
 */
const LOGIN_ON_FILE = "This judge has a login and can sign in at /judge/login.";
const LOGIN_NOT_MADE_YET =
  "This judge has no login yet, so they cannot sign in at /judge/login. The panel is drawn up first and the accounts are made afterwards.";

/** A header cell, and the alignment it shares with the body cells beneath it. */
interface RosterColumn {
  label: string;
  className?: string;
}

/**
 * The header row as data, so the empty row's `colSpan` cannot fall out of step.
 *
 * The span has to equal however many columns are really rendered, and that count is
 * no longer fixed: a page that supplies no actions gets no Actions column. The `6`
 * that used to be written here was only ever right by coincidence, and it fails
 * quietly once it stops being right — the message either stops spanning the table,
 * leaving stray empty columns beside it, or spans past the last one. Deriving the
 * headers and the span from one list makes adding a column a single edit that cannot
 * leave the two disagreeing.
 *
 * The *body* cells stay written out as JSX rather than joining this list. Every one
 * of them renders something different — a badge, a right-aligned count, an em dash
 * for an affiliation nobody recorded — so giving each column a `render` callback
 * would trade six readable cells for six indirections and buy nothing back.
 */
const ROSTER_COLUMNS: readonly RosterColumn[] = [
  { label: "Judge" },
  { label: "Affiliation" },
  { label: "Email" },
  { label: "Events", className: "text-right whitespace-nowrap" },
  { label: "Status" },
  { label: "Login" },
];

/** Appended only when a page passes `renderActions`. */
const ACTIONS_COLUMN: RosterColumn = { label: "Actions", className: "text-right" };

/**
 * The judges on file, and what each is assigned to.
 *
 * Every cell here is read: the row off `judges`, how many events the judge sits on,
 * whether they are active, and whether an account has been made for them yet. The
 * component itself writes nothing and carries no `use client` — it is a plain
 * server-rendered table.
 *
 * ## Why the actions arrive as a render prop
 *
 * The write path exists now — 0029 shipped the roster RPCs — but the controls that
 * call them are client components, each holding its own `useTransition` while a write
 * is in flight, and they live in the route folder beside the server actions they
 * import. A file under `components/` importing back out of `app/` would invert that,
 * so the page passes them down instead.
 *
 * Both sides of the call are server components, so the callback never crosses the
 * client boundary: it runs on the server and returns an element, and where that
 * element is a client component React sends a placeholder for it in the RSC payload.
 * What this buys is the property that makes the table easy to reason about — nothing
 * in this file ships to the browser.
 *
 * Omitting `renderActions` omits the column outright, header included. That replaces
 * a permanently disabled "Assign" button which carried its own absence in a `title`:
 * the reason it gave is now false. Seating is not what replaced it here, either — a
 * seat means something only inside one event, so it belongs to that event's own
 * console (`PanelSeating`), which draws the vacant seats this table has no row for.
 */
export function JudgeRosterTable({
  rows,
  emptyMessage,
  renderActions,
}: {
  rows: JudgeRosterRow[];
  /** Printed when the roster holds nobody. */
  emptyMessage: string;
  /**
   * The per-row controls this page's context justifies, if any. Left off, no Actions
   * column is rendered: a column of blanks reads as controls that failed to draw.
   */
  renderActions?: (row: JudgeRosterRow) => ReactNode;
}) {
  const columns = renderActions ? [...ROSTER_COLUMNS, ACTIONS_COLUMN] : ROSTER_COLUMNS;

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.label} className={column.className}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <JudgingEmptyRow colSpan={columns.length}>{emptyMessage}</JudgingEmptyRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.affiliation ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">{row.email ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{row.events}</TableCell>
                <TableCell>
                  <Badge
                    variant={row.isActive ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    {row.isActive ? "Active" : "Inactive"}
                  </Badge>
                </TableCell>
                <TableCell title={row.hasLogin ? LOGIN_ON_FILE : LOGIN_NOT_MADE_YET}>
                  {/* The same variant pair as Status, for the reason `EventJudgingBadge`
                      gives: an absence should not carry a state's visual weight, so the
                      judge still waiting on an account is outlined rather than filled. */}
                  {/* The words carry the fact on their own. "No login yet" is legible to
                      a reader who cannot tell a filled badge from an outlined one, which
                      is the whole point — the colour is the second telling, never the
                      only one. `title` merely expands on what is already written, which
                      is why it is not repeated into an `sr-only` span: that would read a
                      full sentence per row for a state the badge has already announced. */}
                  <Badge
                    variant={row.hasLogin ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    {row.hasLogin ? "Can sign in" : "No login yet"}
                  </Badge>
                </TableCell>
                {renderActions ? (
                  <TableCell className="text-right">{renderActions(row)}</TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
