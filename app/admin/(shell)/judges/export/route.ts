import { buildJudgesWorkbook } from "@/lib/export/judging-workbook";

import { judgingWorkbookResponse } from "../../judging-export";

/**
 * The workbook behind the export button on /admin/judges.
 *
 * A static segment beside the dynamic `[eventId]` one. Next resolves static first,
 * and event ids are uuids, so "export" can never be read as one.
 */
export async function GET() {
  return judgingWorkbookResponse({
    build: buildJudgesWorkbook,
    slug: "judging-panels",
  });
}
