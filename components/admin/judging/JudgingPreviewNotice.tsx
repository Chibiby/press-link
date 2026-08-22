import { LayoutTemplate } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DEFAULT_ROUND2_CUT } from "@/lib/judging/qualifiers";

/**
 * The one-line reason every empty judging table prints.
 *
 * Shared so the roster, the panel index and both boards cannot each invent their
 * own wording for the same absence. An admin who sees three different sentences
 * on one screen reasonably concludes three different things are wrong.
 */
export const JUDGING_NOT_INSTALLED =
  "No judges, panels, sheets or ranks exist yet — migration 0018 has not run.";

/**
 * Why a round-2 cut is blank.
 *
 * Shared with the same intent as {@link JUDGING_NOT_INSTALLED}: the index table and
 * the detail page both leave this cell empty, and two wordings for one absence read
 * as two different absences. Note what it does *not* say — that the cut is 10. That
 * is the default the RPC will apply, not a decision any event has had taken for it.
 */
export const CUT_NOT_SET =
  "events.round2_cut arrives with migration 0018, so no cut has been chosen for this event.";

/**
 * The banner that stops these pages being filed as a bug.
 *
 * `SoonPage` exists because an unbuilt page dressed up with a table and a
 * disabled button "reads as a shipped feature having a bad day", and its comment
 * says so. These two pages deliberately do the thing that comment warns against
 * — they draw the real table, the real columns and the real actions with nothing
 * in them — because the layout is what is being reviewed. The warning is still
 * correct, so it is answered head on rather than ignored: this notice says, above
 * the fold, exactly which tables are missing, which figures on the page are real,
 * and that nothing here writes.
 *
 * That is the whole difference between a placeholder and a broken page. A
 * placeholder tells you which one it is.
 *
 * It is not `variant="destructive"`: nothing has failed. A red banner here would
 * be its own lie, and it would train an admin to ignore the red banner that
 * appears when a query genuinely breaks (non-negotiable 5).
 */
export function JudgingPreviewNotice() {
  return (
    <Alert>
      <LayoutTemplate />
      <AlertTitle>Layout preview — the judging tables do not exist yet</AlertTitle>
      {/* `break-words` is inherited, so setting it here covers every table name below.
          `0018_judging_and_tabulation` and `round2_qualifiers` are single unbreakable
          tokens as far as the line breaker is concerned — nothing in them is a break
          opportunity — so on a narrow screen they would otherwise push this banner
          wider than the viewport and scroll the whole page sideways. */}
      <AlertDescription className="space-y-2 break-words">
        <p>
          Migration <code className="font-mono text-xs">0018_judging_and_tabulation</code>{" "}
          has not run, so <code className="font-mono text-xs">judges</code>,{" "}
          <code className="font-mono text-xs">judge_assignments</code>,{" "}
          <code className="font-mono text-xs">judge_sheets</code>,{" "}
          <code className="font-mono text-xs">judge_ranks</code>,{" "}
          <code className="font-mono text-xs">round2_qualifiers</code> and{" "}
          <code className="font-mono text-xs">event_rounds</code> are not in the database.
          Nothing on this page can read a judge, a panel, a sheet or a rank.
        </p>
        <p>
          The events and the entry counts <strong>are</strong> real — they come from{" "}
          <code className="font-mono text-xs">events</code> and{" "}
          <code className="font-mono text-xs">entries</code>, which exist today. Every
          judging figure is a structural zero: it means the table is absent, not that the
          number was measured and came out at nought. Each event reads{" "}
          <em>Not started</em> because the shared status function was given a genuinely
          empty panel, not because the status was hard-coded.
        </p>
        <p>
          The round-2 cut is left blank rather than shown as {DEFAULT_ROUND2_CUT}. That is
          the default the division agreed, but until{" "}
          <code className="font-mono text-xs">events.round2_cut</code> is a column, no
          event has actually been set to it, and printing it would invent a decision.
        </p>
        <p>
          The columns, the ordering and the empty states below are the finished page&apos;s,
          so the layout can be reviewed before the schema lands. Every control that would
          change something is disabled, and nothing on this page writes.
        </p>
      </AlertDescription>
    </Alert>
  );
}
