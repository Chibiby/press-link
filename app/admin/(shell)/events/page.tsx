import Link from "next/link";

import { requireAdmin } from "@/app/admin/guard";
import { EventSearch } from "./EventSearch";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EVENTS_PATH,
  eventEmptyState,
  eventTypeCountLabel,
  filterEventRows,
  type EventEmptyState,
  type EventFilters,
} from "@/lib/admin/event-filters";
import {
  buildEventMatrix,
  EVENT_SLOTS,
  teamSize,
  type EventMatrixInput,
  type EventMatrixRow,
} from "@/lib/dashboard/event-matrix";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";

interface CatalogEventRow {
  id: string;
  level: EventLevel;
  language: EventLanguage;
  event_types: {
    id: string;
    name_en: string;
    name_fil: string;
    category: EventCategory;
    min_participants: number;
    max_participants: number | null;
    sort_order: number;
  } | null;
  entries: { count: number }[];
}

/**
 * One category's block. Both blocks are the same table, so it is written once —
 * including the empty state, which is why the sentence is passed in rather than
 * written here: a query for "news" fills Individual and empties Group, and the
 * two have to say different things about the same query.
 */
function MatrixTable({ rows, empty }: { rows: EventMatrixRow[]; empty: EventEmptyState }) {
  return (
    // Dimmed while the search box's navigation is still rendering on the server,
    // so the tables read as catching up rather than as ignoring what was typed;
    // driven by `data-pending` on the box above. `overflow-x-auto` because this is
    // six columns and `Card` is `overflow-hidden` — on a phone the slot columns
    // were clipped with no way to reach them. The scroll stays inside this
    // wrapper, so the page body never moves sideways.
    <div className="overflow-x-auto transition-opacity group-has-data-pending:opacity-50">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event type</TableHead>
            <TableHead className="whitespace-nowrap">Team size</TableHead>
            {EVENT_SLOTS.map((slot) => (
              <TableHead key={slot.key} className="whitespace-nowrap text-right">
                {slot.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.typeId}>
              <TableCell>
                <p className="font-medium">{row.typeNameEn}</p>
                {/* Group contests and MOJO carry identical English and Filipino names in the
                    source workbook, so the second line is suppressed rather than repeated. */}
                {row.typeNameFil === row.typeNameEn ? null : (
                  <p className="text-xs text-muted-foreground">{row.typeNameFil}</p>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                {teamSize(row)}
              </TableCell>
              {EVENT_SLOTS.map((slot) => {
                const cell = row.slots[slot.key];
                return (
                  <TableCell key={slot.key} className="text-right tabular-nums">
                    {cell === null ? (
                      // An em dash, not a zero: this contest is not offered at this level, so
                      // there is nothing to enter. A `0` here would read as "nobody entered".
                      // The title carries that to a sighted hover and the screen-reader-only
                      // span carries it to assistive tech, which would otherwise hear only the
                      // bare punctuation.
                      <span title="Not offered at this level">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">Not offered at this level</span>
                      </span>
                    ) : (
                      cell.entries
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              {/* `whitespace-normal`, because `TableCell` sets `whitespace-nowrap`
                  in its base and this cell quotes back whatever was typed — a
                  pasted line would otherwise stretch the table sideways instead of
                  wrapping. The span is derived from `EVENT_SLOTS` for the same
                  reason the header row is: the four slot columns plus type and
                  team size. */}
              <TableCell
                colSpan={EVENT_SLOTS.length + 2}
                className="py-10 text-center whitespace-normal"
              >
                <p className="mx-auto max-w-[60ch] text-sm text-balance break-words text-muted-foreground">
                  {empty.message}
                </p>
                {empty.narrowed && (
                  // A way back, on the table itself — where the reader is looking —
                  // and a link is the honest control for it in a server component.
                  // Navigating here empties the search box too: the box follows the
                  // URL, so it clears when the param goes.
                  <Button asChild size="sm" variant="outline" className="mt-3">
                    <Link href={EVENTS_PATH}>Show the whole catalog</Link>
                  </Button>
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function AdminEventsPage({
  searchParams,
}: {
  // A Promise, and awaited below — that is what a page is handed in this version
  // of Next. `EventFilters` rather than a shape declared here, so the page and the
  // filter it hands these to cannot disagree about the param's name, which is a
  // mistake with no symptom other than a control that silently does nothing.
  searchParams: Promise<EventFilters>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  const { data, error } = await supabase
    .from("events")
    .select(
      "id, level, language, event_types(id, name_en, name_fil, category, min_participants, max_participants, sort_order), entries(count)"
    )
    .overrideTypes<CatalogEventRow[]>();

  // A failed query would leave `rows` empty and every figure below would compute to zero,
  // rendering "0 events across 0 contest types" as though the division ran no contests. That
  // is the same mistake as printing `0` for a contest that is not offered, one level up, so
  // the failure is shown as a failure rather than counted as an absence.
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeading title="Events" subtitle="The contest catalog could not be loaded." />
        <Alert variant="destructive">
          <AlertTitle>Could not load events</AlertTitle>
          <AlertDescription>
            The contest catalog could not be loaded, so no counts are shown — this is not a
            report that the division has no events. Please try refreshing the page.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const rows: EventMatrixInput[] = (data ?? []).flatMap((row) =>
    // events.event_type_id is NOT NULL since migration 0003, so a null type here is a
    // broken key rather than an unclassified event — dropped, not printed unlabelled.
    row.event_types
      ? [
          {
            eventId: row.id,
            typeId: row.event_types.id,
            typeNameEn: row.event_types.name_en,
            typeNameFil: row.event_types.name_fil,
            category: row.event_types.category,
            minParticipants: row.event_types.min_participants,
            maxParticipants: row.event_types.max_participants,
            sortOrder: row.event_types.sort_order,
            level: row.level,
            language: row.language,
            entries: row.entries?.[0]?.count ?? 0,
          },
        ]
      : []
  );

  const matrix = buildEventMatrix(rows);

  // Each section is narrowed on its own, because a query legitimately belongs to
  // one of them: "news" fills Individual and empties Group, and each table then
  // says so in its own words. The heading's badge and subtitle stay off the
  // unsearched matrix — "56 events across 16 contest types" is a fact about the
  // catalog, not a count of what is on screen — which is also why there is no
  // `fetchAll` and no "N of M" row count here: 56 rows in one unpaged select
  // cannot reach PostgREST's cap, so a count framed as protection against
  // truncation would answer a risk this page does not have.
  const individual = filterEventRows(matrix.individual, params);
  const group = filterEventRows(matrix.group, params);

  return (
    // `group` so the search box below can dim both tables through one
    // `data-pending` attribute. Nothing in this subtree uses an unnamed `group-*`
    // variant and every group in `components/ui` is named, so there is nothing
    // here for it to cross-talk with.
    <div className="group space-y-6">
      <PageHeading
        title="Events"
        badge={`${matrix.typesWithEntries} of ${matrix.typesTotal} contested`}
        subtitle={`${matrix.eventsTotal} events across ${matrix.typesTotal} contest types, carrying ${matrix.entriesTotal} entries. A dash means the contest is not offered at that level.`}
      />

      <EventSearch />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Individual</CardTitle>
          <CardDescription>
            {/* Counts the rows in this card, not the whole category: a caption
                reading "10 types" above a single searched row is a caption
                disagreeing with the table under it. The heading above stays
                catalog-wide, so nothing here hides how big the catalog is. */}
            {eventTypeCountLabel(individual.length)}. One learner competes, with up to two
            reserves on the entry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MatrixTable rows={individual} empty={eventEmptyState(params, "individual")} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Group</CardTitle>
          <CardDescription>
            {eventTypeCountLabel(group.length)}. A whole team enters together.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MatrixTable rows={group} empty={eventEmptyState(params, "group")} />
        </CardContent>
      </Card>
    </div>
  );
}
