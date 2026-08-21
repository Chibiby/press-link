import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PerSchoolSummary } from "@/lib/dashboard/per-school";

export function PerSchoolTable({ summary }: { summary: PerSchoolSummary }) {
  if (summary.rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No school has an entry yet. Rows appear here as schools submit.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>School</TableHead>
            <TableHead>District</TableHead>
            <TableHead className="text-right">Learners</TableHead>
            <TableHead className="text-right">Coaches</TableHead>
            <TableHead className="text-right">Entries</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.rows.map((row) => (
            <TableRow key={row.schoolId}>
              <TableCell className="font-medium text-foreground">
                {row.schoolName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.districtName || "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.learners.toLocaleString("en-PH")}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.coaches.toLocaleString("en-PH")}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {row.entries.toLocaleString("en-PH")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          {/* Division-wide, not a sum of the visible rows — Task 8 totals every
              active school, including the ones the top-N cut off. */}
          <TableRow>
            <TableCell className="font-semibold text-foreground">
              Division total
            </TableCell>
            <TableCell className="text-muted-foreground">
              {summary.activeSchools} of {summary.registeredSchools} schools
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {summary.totals.learners.toLocaleString("en-PH")}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {summary.totals.coaches.toLocaleString("en-PH")}
            </TableCell>
            <TableCell className="text-right font-semibold tabular-nums">
              {summary.totals.entries.toLocaleString("en-PH")}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {summary.hiddenSchools > 0 ? (
        <p className="text-xs text-muted-foreground">
          Showing the top {summary.rows.length} by entries.{" "}
          {summary.hiddenSchools} more active{" "}
          {summary.hiddenSchools === 1 ? "school is" : "schools are"} counted in the
          division total but not listed.
        </p>
      ) : null}
    </div>
  );
}
