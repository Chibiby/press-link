import { JudgingEmptyRow } from "@/components/admin/judging/EventJudgingBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
 */
export interface JudgeRosterRow {
  id: string;
  /** Surname-first, via `lib/roster/names`, so it sorts with the rest of the app. */
  name: string;
  affiliation: string | null;
  email: string | null;
  /** How many events this judge sits on. */
  events: number;
  isActive: boolean;
}

/**
 * The judges on file, and what each is assigned to.
 *
 * Every cell here is read. The action column is drawn but inert, because assigning
 * a judge to an event needs a write path that has not been built — `judge_assignments`
 * is in the database, the function that inserts into it is not. A disabled button with
 * no explanation is the failure mode `SoonPage` warns about, so the button carries
 * that reason in its `title`: the absence is a missing function, not a missing table,
 * and those call for different responses.
 */
export function JudgeRosterTable({
  rows,
  emptyMessage,
}: {
  rows: JudgeRosterRow[];
  emptyMessage: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Judge</TableHead>
            <TableHead>Affiliation</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="text-right whitespace-nowrap">Events</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <JudgingEmptyRow colSpan={6}>{emptyMessage}</JudgingEmptyRow>
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
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled
                    title="Assigning a judge to an event needs the assign-judge RPC, which has not been built yet. judge_assignments is ready for it."
                  >
                    Assign
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
