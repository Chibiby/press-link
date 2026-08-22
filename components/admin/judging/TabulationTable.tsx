import { JudgingEmptyRow } from "@/components/admin/judging/EventJudgingBadge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TABULATION_COLUMNS, tabulationCell } from "@/lib/judging/tabulation";
import type { TabulationRow } from "@/lib/judging/types";

/**
 * The tabulators' identified sheet.
 *
 * Both the header and every cell come from `lib/judging/tabulation`:
 * `TABULATION_COLUMNS` gives the columns and their order, `tabulationCell` gives
 * the text. Neither is restated here, because that module is shared with the
 * workbook export and the comment on it is explicit about why — the spreadsheet a
 * tabulator downloads must not have different columns in a different order from
 * the page they downloaded it from. A hard-coded `<TableHead>Code</TableHead>` in
 * this file is exactly how that guarantee would be lost.
 *
 * ## The note on total rank is not decoration
 *
 * Non-negotiable 6 requires the caveat wherever the column appears, and
 * `TABULATION_COLUMNS` carries it on the column itself so a surface cannot render
 * the column without having the caveat to hand. It is printed twice on purpose:
 * as a marker in the header, for someone scanning the table, and in full beneath
 * it, for someone about to act on the number. The screen-reader-only span carries
 * it to assistive tech, which would otherwise hear a bare asterisk.
 */
export function TabulationTable({
  rows,
  emptyMessage,
}: {
  rows: TabulationRow[];
  emptyMessage: string;
}) {
  const noted = TABULATION_COLUMNS.filter((column) => column.note);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {TABULATION_COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  className={
                    column.numeric ? "text-right whitespace-nowrap" : "whitespace-nowrap"
                  }
                >
                  {column.label}
                  {column.note ? (
                    <span className="ml-0.5 font-normal text-muted-foreground" title={column.note}>
                      <span aria-hidden="true">*</span>
                      <span className="sr-only"> — {column.note}</span>
                    </span>
                  ) : null}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <JudgingEmptyRow colSpan={TABULATION_COLUMNS.length}>
                {emptyMessage}
              </JudgingEmptyRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.unitKey}>
                  {TABULATION_COLUMNS.map((column) => (
                    <TableCell
                      key={column.key}
                      className={
                        column.numeric
                          ? "text-right tabular-nums"
                          : column.key === "code"
                            ? "font-mono font-medium tabular-nums"
                            : undefined
                      }
                    >
                      {tabulationCell(row, column.key)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {noted.length === 0 ? null : (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {noted.map((column) => (
            <li key={column.key}>
              <span aria-hidden="true">* </span>
              <strong className="font-medium">{column.label}:</strong> {column.note}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
