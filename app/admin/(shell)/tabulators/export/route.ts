import { buildTabulatorsWorkbook } from "@/lib/export/judging-workbook";

import { judgingWorkbookResponse } from "../../judging-export";

/** The workbook behind the export button on /admin/tabulators. */
export async function GET() {
  return judgingWorkbookResponse({
    build: buildTabulatorsWorkbook,
    slug: "tabulation-sheets",
  });
}
