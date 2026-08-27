"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

import { submitJudgeSheetAction } from "../../actions";
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
 * The ranking sheet: a code, and a rank for it. Three columns and nothing else,
 * because there is nothing else a judge is allowed to know.
 *
 * ## Why the blank option carries a word
 *
 * Round 1's dropdown offers "— Eliminated" rather than an empty row. A blank is
 * a final answer (N2), and an unlabelled empty option reads as "not yet
 * answered" — a judge who reads it that way will rank the whole field and defeat
 * the cut.
 *
 * ## Why submitting asks first
 *
 * Submitting is locking, per the division's "once naka rank, i-lock". The judge
 * cannot undo it; an admin has to. A confirm step is the cheapest thing that
 * stops a misplaced click becoming an administrative errand.
 *
 * The draft is validated here for the message and again in the server action,
 * which re-reads the sheet, and a third time inside `judge_submit_sheet`, which
 * is the actual boundary (non-negotiable 2).
 */
export function RankingSheet({
  eventId,
  units,
  spec,
  initialDraft,
  editable,
}: {
  eventId: string;
  units: ContestUnit[];
  spec: SheetFormSpec;
  initialDraft: RankDraft;
  editable: boolean;
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
      const result = await submitJudgeSheetAction(eventId, draft);
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
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Submit sheet
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Submit this sheet?</AlertDialogTitle>
                <AlertDialogDescription>
                  Submitting locks your sheet. You will not be able to change a rank
                  afterwards &mdash; an administrator has to unlock it for you.
                  {spec.allowsBlank
                    ? ` You have ranked ${ranked} of ${units.length}; the rest are recorded as eliminated.`
                    : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep editing</AlertDialogCancel>
                <AlertDialogAction onClick={submit}>Submit and lock</AlertDialogAction>
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
 * The dropdown's value for a blank.
 *
 * Radix's `Select` refuses an empty-string item value, and it needs *some*
 * value: the alternative is a controlled component whose blank state is
 * `undefined`, which renders the placeholder and makes "eliminated" look like
 * "unanswered". A sentinel keeps the blank a real, selectable answer.
 */
const BLANK = "blank";
