"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Scissors, TriangleAlert } from "lucide-react";

import { previewBulkCutAction, runBulkCutAction, type BulkCutPreview } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Raise every cut that is standing below the number its judge ranked.
 *
 * Since migration 0032 a round-1 judge ranks as far down the field as they mean to
 * and the cut decides who advances, so the two numbers are free to disagree. When
 * the cut is the smaller one the difference is a contestant the judge placed and the
 * round eliminated — a legitimate outcome, and on a closed round an invisible one
 * until somebody counts the exported sheet.
 *
 * ## Why the preview is the point
 *
 * Every event this touches has to be reopened and closed again. That is not a thing
 * to do to forty contests on trust, so the dialog names each one, what its cut is,
 * what it becomes, and how many are on its qualifier list today — and says which
 * events it will not touch and why, before there is anything to press.
 */
export function BulkCutDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<BulkCutPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isRunning, startRunning] = useTransition();
  const [, startRefresh] = useTransition();

  const load = useCallback(() => {
    setError(null);
    setPreview(null);
    startLoading(async () => {
      const result = await previewBulkCutAction();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPreview(result.preview);
    });
  }, []);

  function run() {
    setError(null);
    startRunning(async () => {
      const result = await runBulkCutAction();
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(result.summary, {
        description: result.failed.length
          ? `Refused: ${result.failed.map((row) => row.eventName).join(", ")}.`
          : undefined,
      });
      setOpen(false);
      setPreview(null);
      // Owned here, by the component that stays mounted: a refresh scheduled inside
      // a transition whose owner unmounts is dropped, leaving a raised cut still
      // reading as the old one.
      startRefresh(() => {
        router.refresh();
      });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
        else {
          setPreview(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Scissors />
          Match cuts to ranks
        </Button>
      </DialogTrigger>
      <DialogContent className="grid max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Match each cut to what was ranked</DialogTitle>
          <DialogDescription>
            A judge ranks as far down the field as they mean to, and the cut decides who
            advances. Where a cut is the smaller number, somebody the judge placed did not go
            through. This raises those cuts so everyone ranked qualifies.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto py-4">
          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking every event…
            </p>
          ) : null}

          {preview && preview.steps.length > 0 ? (
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <TriangleAlert className="size-4 shrink-0 translate-y-0.5 text-amber-600 dark:text-amber-500" />
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">A closed round is reopened and
                closed again.</span>{" "}
                The judge&rsquo;s sheet is reopened, the cut is raised, the same ranks are
                submitted again untouched, and the qualifier list is redrawn — the people who
                were on it, plus the ones the old cut kept out. No rank moves.
              </p>
            </div>
          ) : null}

          {preview ? (
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">
                {preview.steps.length} {preview.steps.length === 1 ? "event" : "events"} to
                raise
              </p>
              {preview.steps.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {preview.steps.map((step) => (
                    <li key={step.eventId}>
                      <span className="font-medium">{step.eventName}</span>
                      <span className="block text-muted-foreground">
                        Cut {step.from ?? "—"} → {step.to}
                        {step.wasLocked
                          ? ` · ${step.qualifiers} on the qualifier list today, ${step.to} after`
                          : " · round 1 is still open, so nothing is reopened"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  Every event&rsquo;s cut already lets through everyone its judge ranked.
                  Nothing to do.
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                {preview.unchanged}{" "}
                {preview.unchanged === 1 ? "event is" : "events are"} left alone — either
                nobody has ranked them yet, or their cut already admits everyone who was.
              </p>
            </div>
          ) : null}

          {preview && preview.skipped.length > 0 ? (
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium">{preview.skipped.length} this cannot fix</p>
              <ul className="mt-2 space-y-2 text-sm">
                {preview.skipped.map((row) => (
                  <li key={row.eventId}>
                    <span className="font-medium">{row.eventName}</span>
                    <span className="block text-muted-foreground">{row.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={isRunning} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={isRunning || isLoading || !preview || preview.steps.length === 0}
            onClick={run}
          >
            {isRunning && <Loader2 className="size-4 animate-spin" />}
            Raise {preview?.steps.length ?? 0}{" "}
            {preview?.steps.length === 1 ? "cut" : "cuts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
