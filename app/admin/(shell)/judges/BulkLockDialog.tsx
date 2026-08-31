"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Lock, TriangleAlert } from "lucide-react";

import { previewBulkLockAction, runBulkLockAction, type BulkLockPreview } from "./actions";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BULK_LOCK_SCOPES, bulkLockScope } from "@/lib/judging/bulk-lock";

/**
 * Close a round across the whole catalog at once.
 *
 * The panel page locks one event at a time, which is right when an admin is
 * standing at one panel and wrong at the end of a contest day, when forty
 * individual events have finished and each needs the same two clicks — and where
 * the cost of missing one is a round left open with nothing on screen to say it
 * was overlooked.
 *
 * ## Why it previews before it offers the button
 *
 * A bulk action's whole premise is that the admin cannot see what it covers. The
 * preview is the same information a toast would give afterwards, in the one place
 * it can still change the decision: how many events will close, which, and — the
 * half that matters — which will not and why. Nothing is locked until the second
 * button.
 */
export function BulkLockDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scopeId, setScopeId] = useState("");
  const [preview, setPreview] = useState<BulkLockPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isRunning, startRunning] = useTransition();
  const [, startRefresh] = useTransition();

  const scope = bulkLockScope(scopeId);

  const choose = useCallback((value: string) => {
    setScopeId(value);
    setPreview(null);
    setError(null);
    startLoading(async () => {
      const result = await previewBulkLockAction(value);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setPreview(result.preview);
    });
  }, []);

  function run() {
    if (!scope) return;
    setError(null);
    startRunning(async () => {
      const result = await runBulkLockAction(scope.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      // The failures ride in the description rather than a second toast: they are a
      // detail of this run, and a reader who dismisses the first has dismissed the
      // whole answer.
      toast.success(result.summary, {
        description: result.failed.length
          ? `Refused: ${result.failed.map((row) => row.eventName).join(", ")}.`
          : undefined,
      });
      setOpen(false);
      setScopeId("");
      setPreview(null);
      // Owned by this component, which stays mounted: a refresh scheduled inside a
      // transition whose owner unmounts is dropped, leaving a locked round still
      // reading as open.
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
        if (!next) {
          setScopeId("");
          setPreview(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Lock />
          Bulk lock
        </Button>
      </DialogTrigger>
      <DialogContent className="grid max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Lock rounds in bulk</DialogTitle>
          <DialogDescription>
            One pass over the whole catalog. Every event is checked against the same rules
            the panel page checks, and nothing is locked until you press the second button.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto py-4">
          <div className="space-y-2">
            <Label htmlFor="bulk-scope">What to lock</Label>
            <Select value={scopeId} onValueChange={choose}>
              <SelectTrigger id="bulk-scope" className="w-full">
                <SelectValue placeholder="Choose a round" />
              </SelectTrigger>
              <SelectContent>
                {BULK_LOCK_SCOPES.map((option) => (
                  // The two group scopes are offered and disabled rather than left
                  // out: leaving them off the list would answer the question by
                  // pretending nobody asked it.
                  <SelectItem
                    key={option.id}
                    value={option.id}
                    disabled={option.controls.length === 0}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {scope ? <p className="text-xs text-muted-foreground">{scope.detail}</p> : null}
          </div>

          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking every event…
            </p>
          ) : null}

          {preview?.unavailable ? (
            <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <TriangleAlert className="size-4 shrink-0 translate-y-0.5 text-amber-600 dark:text-amber-500" />
              <p className="text-sm text-muted-foreground">{preview.unavailable}</p>
            </div>
          ) : null}

          {preview && !preview.unavailable ? (
            <div className="space-y-4">
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4 text-muted-foreground" />
                  {preview.steps.length} {preview.steps.length === 1 ? "event" : "events"} will
                  be locked
                </p>
                {preview.steps.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {preview.steps.map((step) => (
                      <li key={`${step.eventId}-${step.control}`}>{step.eventName}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Nothing in the catalog is ready for this. Every event is listed below with
                    the reason.
                  </p>
                )}
              </div>

              {preview.skipped.length > 0 ? (
                <div className="rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    {preview.skipped.length} not ready
                  </p>
                  {/* Each carries the per-event control's own sentence. "Round 1's
                      judge has not submitted a sheet yet" is something an admin can
                      act on; "not eligible" is not. */}
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
            Lock {preview?.steps.length ?? 0}{" "}
            {preview?.steps.length === 1 ? "event" : "events"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
