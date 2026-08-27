"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { validateSheetDraft, type RankDraft, type SheetFormSpec } from "@/lib/judging/sheet-form";
import type { ContestUnit } from "@/lib/judging/types";

/**
 * The ranking sheet: a code, and a rank for it. Two columns and nothing else,
 * because there is nothing else a judge is allowed to know.
 *
 * ## Why one component serves both hands
 *
 * There are two ways a sheet gets filled — the judge types it at `/judge/[eventId]`,
 * or an admin encodes it from a paper sheet at `/admin/judges/[eventId]/enter/[judgeId]`
 * (N9) — and the database treats them as the same write: `judge_submit_sheet` and
 * `admin_enter_sheet` both call `judging_write_sheet`, which validates identically
 * and differs only in whose id lands in `entered_by`. A second copy of this form for
 * the admin would be a second reading of N2 and N5, free to drift from this one, and
 * the drift would show up as an admin-typed sheet the database rejects for a reason
 * the screen never mentioned.
 *
 * So the form takes the write as a prop. `onSubmit` is a server action the caller has
 * already bound its own arguments onto — the event for a judge, the event and the
 * judge for an admin — and everything either side does differently is a string.
 *
 * ## Why the blank option carries a word
 *
 * Round 1's dropdown offers "— Eliminated" rather than an empty row. A blank is a
 * final answer (N2), and an unlabelled empty option reads as "not yet answered" — a
 * reader who takes it that way will rank the whole field and defeat the cut.
 *
 * ## Why submitting asks first
 *
 * Writing a sheet is submitting it, and submitting is locking — the division's "once
 * naka rank, i-lock". Nobody can revise afterwards; an admin has to unlock. A confirm
 * step is the cheapest thing that stops a misplaced click becoming an administrative
 * errand.
 *
 * The draft is validated here for the message, again in the server action, which
 * re-reads the sheet, and a third time inside `judging_write_sheet`, which is the
 * actual boundary (non-negotiable 2).
 */
export function RankingSheetForm({
  units,
  spec,
  initialDraft,
  editable,
  onSubmit,
  submitLabel,
  confirmTitle,
  confirmLead,
  confirmAction,
}: {
  units: ContestUnit[];
  spec: SheetFormSpec;
  initialDraft: RankDraft;
  editable: boolean;
  /**
   * The write, with its ids already bound on by the caller. A server action rather
   * than a client fetch, so the payload is re-checked against a freshly read sheet
   * before it ever reaches the RPC.
   */
  onSubmit: (draft: RankDraft) => Promise<{ error: string } | void>;
  /** The button. "Submit sheet" for a judge, "Save sheet" for an admin encoding one. */
  submitLabel: string;
  confirmTitle: string;
  /**
   * What locking means for whoever is reading. The tally of ranked-versus-eliminated
   * is appended by this component, so a caller never has to count the draft itself.
   */
  confirmLead: string;
  confirmAction: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<RankDraft>(initialDraft);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const invalid = useMemo(
    () => validateSheetDraft(spec, units, draft),
    [spec, units, draft]
  );

  const ranked = units.filter((unit) => (draft[unit.unitKey] ?? null) !== null).length;

  function setRank(unitKey: string, value: string) {
    setError(null);
    setDraft((current) => ({
      ...current,
      [unitKey]: value === BLANK ? null : Number(value),
    }));
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await onSubmit(draft);
      if (result?.error) {
        setError(result.error);
        return;
      }
      // The sheet is read-only from here, so the page has to be re-read rather
      // than left showing an editable form over a submitted sheet.
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Code</TableHead>
              <TableHead>Rank</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map((unit) => {
              const value = draft[unit.unitKey] ?? null;
              return (
                <TableRow key={unit.unitKey}>
                  <TableCell className="font-mono text-base font-medium tabular-nums">
                    {unit.code}
                  </TableCell>
                  <TableCell>
                    {editable ? (
                      <Select
                        value={value === null ? BLANK : String(value)}
                        onValueChange={(next) => setRank(unit.unitKey, next)}
                      >
                        <SelectTrigger
                          aria-label={`Rank for contestant ${unit.code}`}
                          className="w-44"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {spec.allowsBlank ? (
                            <SelectItem value={BLANK}>&mdash; Eliminated</SelectItem>
                          ) : null}
                          {spec.options.map((option) => (
                            <SelectItem key={option} value={String(option)}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-sm">
                        {value === null ? (
                          <span className="text-muted-foreground">&mdash; Eliminated</span>
                        ) : (
                          <span className="font-medium tabular-nums">{value}</span>
                        )}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {editable ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {ranked} of {units.length} ranked
            {spec.allowsBlank ? ", the rest eliminated" : ""}.
          </p>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={isPending || invalid !== null}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    {submitLabel}
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {confirmLead}
                  {spec.allowsBlank
                    ? ` ${ranked} of ${units.length} are ranked; the rest are recorded as eliminated.`
                    : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep editing</AlertDialogCancel>
                <AlertDialogAction onClick={submit}>{confirmAction}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}

      {editable && invalid ? (
        <p className="text-sm text-muted-foreground">{invalid}</p>
      ) : null}
    </div>
  );
}

/**
 * The dropdown's value for "no rank". Radix needs a non-empty string, and the
 * empty string is reserved for its own placeholder handling.
 */
const BLANK = "blank";
