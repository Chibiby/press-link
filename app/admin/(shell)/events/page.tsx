import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

/** One category's block. Both blocks are the same table, so it is written once. */
function MatrixTable({ rows }: { rows: EventMatrixRow[] }) {
  return (
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
          <TableHead className="text-right">Entries</TableHead>
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
            <TableCell className="text-right font-medium tabular-nums">
              {row.entries === 0 ? (
                <Badge variant="outline">None yet</Badge>
              ) : (
                row.entries
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function AdminEventsPage() {
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

  return (
    <div className="space-y-6">
      <PageHeading
        title="Events"
        badge={`${matrix.typesWithEntries} of ${matrix.typesTotal} contested`}
        subtitle={`${matrix.eventsTotal} events across ${matrix.typesTotal} contest types, carrying ${matrix.entriesTotal} entries. A dash means the contest is not offered at that level.`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Individual</CardTitle>
          <CardDescription>
            {matrix.individual.length} types. One learner competes, with up to two reserves on
            the entry.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MatrixTable rows={matrix.individual} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Group</CardTitle>
          <CardDescription>
            {matrix.group.length} types. A whole team enters together.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MatrixTable rows={matrix.group} />
        </CardContent>
      </Card>
    </div>
  );
}
