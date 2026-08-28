"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, Loader2, TimerReset } from "lucide-react";

import { allowRevisionAction, revokeRevisionAction } from "./revision-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import {
  DEFAULT_DURATION_MINUTES,
  DURATION_PRESETS,
  REVISION_SURFACES,
  SURFACE_DETAIL,
  SURFACE_LABEL,
  type RevisionSurface,
} from "@/lib/submissions/revision-grant";

/**
 * One dialog for both "Allow revision" and "Change".
 *
 * They are the same write. `admin_grant_revision` revokes whatever live grant the
 * school holds and inserts the new one inside a single RPC — that is what makes
 * the row granted at 3:49 survive the extension at 4:05 — so there is nothing for
 * this component to branch on beyond its title and its button label. A second
 * dialog for "Change" would be the same three checkboxes, the same duration and
 * the same action behind a different heading, and the first divergence between
 * the two copies would be a bug nobody could see from either file.
 *
 * Everything time-shaped arrives pre-formatted from the page as a plain string,
 * following `SubmissionsLockDialog`: `formatExpiry()` is `Intl.DateTimeFormat`,
 * and Node's ICU and the browser's disagree about the space before "PM", which is
 * a hydration mismatch nobody can see.
 */
export function AllowRevisionDialog({
  schoolId,
  schoolName,
  mode,
  currentGrant,
}: {
  schoolId: string;
  schoolName: string;
  /** Only the title and the button label depend on this — see the note above. */
  mode: "grant" | "change";
  /**
   * `describeGrant(grant, formatExpiry(grant.expiresAt))`, formatted on the
   * server. Null unless the school already holds a grant, i.e. always null in
   * `grant` mode.
   */
  currentGrant?: string | null;
}) {
  const router = useRouter();
  const groupId = useId();
  const durationId = useId();
  const surfaceId = (surface: RevisionSurface) => `${groupId}-${surface}`;

  const [open, setOpen] = useState(false);
  // All three on, because the office's request is "let them fix it" far more
  // often than it is "let them fix exactly one part of it" — the narrower grant
  // is the deliberate act, so it takes the deliberate click.
  const [surfaces, setSurfaces] = useState<RevisionSurface[]>([...REVISION_SURFACES]);
  const [minutes, setMinutes] = useState(DEFAULT_DURATION_MINUTES);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function show(next: boolean) {
    setOpen(next);
    if (!next) {
      // A failure from the last attempt must not be the first thing the next open
      // shows, and a narrowed scope must not persist into the next school the
      // admin reopens — the default is the answer, so it is restored.
      setSurfaces([...REVISION_SURFACES]);
      setMinutes(DEFAULT_DURATION_MINUTES);
      setError(null);
    }
  }

  function toggle(surface: RevisionSurface, checked: boolean) {
    // Rebuilt from the tuple rather than pushed onto, so the list stays in
    // `REVISION_SURFACES` order however the boxes were clicked. The action
    // re-derives it the same way; this only keeps the two from disagreeing about
    // what was sent.
    setSurfaces(
      REVISION_SURFACES.filter((s) => (s === surface ? checked : surfaces.includes(s))),
    );
  }

  function handleSubmit(event: React.FormEvent) {
    // The dialog has to survive a failure so the error below can be read, and a
    // form submit would navigate.
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await allowRevisionAction(schoolId, surfaces, minutes);

      if ("error" in result) {
        // Inline and persistent, not a toast. This is an authorization change
        // with a deadline on it: an admin who looks away while the request is in
        // flight loses a toast entirely, and the two failures that actually
        // happen here — another administrator granting first, and 0031 not being
        // applied on this environment — both need to be read rather than glimpsed.
        setError(result.error);
        return;
      }

      toast.success(`${schoolName} can revise its submission again.`);
      show(false);
      router.refresh();
    });
  }

  const canSubmit = surfaces.length > 0;

  return (
    <Dialog open={open} onOpenChange={show}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {mode === "change" ? <TimerReset className="size-4" /> : <Clock className="size-4" />}
          {mode === "change" ? "Change" : "Allow revision"}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "change" ? "Change the revision window" : "Allow revision"}
          </DialogTitle>
          <DialogDescription>
            {schoolName} can edit the parts you tick, for as long as you choose.
            The division-wide lock stays on for every other school, and this
            school&apos;s own lock is left exactly as it is.
          </DialogDescription>
        </DialogHeader>

        {/* Named rather than merely replaced. In `change` mode the new window
            starts now and the old one is revoked, so an admin extending a grant
            that already ran twenty minutes needs to see what they are replacing. */}
        {currentGrant ? (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {currentGrant}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* A fieldset and legend, not a `<p>` above the boxes: the group is the
              thing being labelled, and a screen reader announcing "School paper,
              checkbox" with no idea what the three belong to is the version that
              reads as three unrelated switches. There is no checkbox in
              `components/ui/`, so these are native inputs styled with the theme's
              accent colour rather than a fourth primitive added for one dialog. */}
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">What may they revise?</legend>

            {REVISION_SURFACES.map((surface) => (
              <div key={surface} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  id={surfaceId(surface)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={surfaces.includes(surface)}
                  aria-describedby={`${surfaceId(surface)}-detail`}
                  onChange={(e) => toggle(surface, e.target.checked)}
                />
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor={surfaceId(surface)}>{SURFACE_LABEL[surface]}</Label>
                  {/* The label alone is not enough to grant safely: "School paper"
                      does not say the contest answer rides along with it. */}
                  <p
                    id={`${surfaceId(surface)}-detail`}
                    className="text-xs text-muted-foreground"
                  >
                    {SURFACE_DETAIL[surface]}
                  </p>
                </div>
              </div>
            ))}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={durationId}>How long</Label>
            {/* A closed set of six, so a Select rather than a typed number,
                following `AddSchoolDialog` next door. `DURATION_PRESETS` tops out
                at the 1440 minutes the RPC clamps to, so nothing offered here can
                be silently narrowed by the database. */}
            <Select
              value={String(minutes)}
              onValueChange={(next) => setMinutes(Number(next))}
            >
              <SelectTrigger id={durationId} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_PRESETS.map((preset) => (
                  <SelectItem key={preset.minutes} value={String(preset.minutes)}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The window closes on its own. Nothing has to be switched back.
            </p>
          </div>

          {/* The reason, in text, beside a button that is about to be dead. A
              disabled control with no explanation is read as broken, and the
              server would refuse this anyway — an empty grant permits nothing
              while looking, in the table, exactly like one that permits something. */}
          {!canSubmit ? (
            <p className="text-sm text-muted-foreground">
              Tick at least one part before you reopen it.
            </p>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === "change" ? "Change window" : "Allow revision"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Closes a school's window early, after a confirmation.
 *
 * A confirmation rather than a plain button — unlike `Unlock` beside it, which
 * only ever gives access back — because this takes away a window a school may be
 * typing into at this moment, and the next thing that school sees is a save it
 * cannot make. The dialog says whose window and until when, so the admin can tell
 * they are about to cut short the right one.
 *
 * It lives in this file rather than in `AccountRowActions.tsx` because both
 * controls are the same feature and both read `revision-actions.ts`; the file the
 * Revision cell imports is then one file, not two.
 */
export function RevokeRevisionButton({
  schoolId,
  schoolName,
  currentGrant,
}: {
  schoolId: string;
  schoolName: string;
  /**
   * `describeGrant(...)` from the page, formatted on the server. Nullable only
   * because the page derives it from the same grant that decided this button
   * renders at all — an unreachable pairing, stated rather than asserted away
   * with a `?? ""` that would put an empty line in the confirmation.
   */
  currentGrant: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function show(next: boolean) {
    setOpen(next);
    if (!next) setError(null);
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await revokeRevisionAction(schoolId);

      if ("error" in result) {
        setError(result.error);
        return;
      }

      toast.success(`${schoolName}'s revision window is closed.`);
      show(false);
      router.refresh();
    });
  }

  return (
    <>
      {/* Outside the root and opened by state, following `SubmissionsLockDialog`,
          rather than through `AlertDialogTrigger`: the button sits in a table cell
          beside two others and has to be an ordinary sibling of them. */}
      <Button variant="outline" size="sm" onClick={() => show(true)}>
        Revoke
      </Button>

      <AlertDialog open={open} onOpenChange={show}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close {schoolName}&apos;s revision window?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-3">
                {currentGrant ? <p className="text-foreground">{currentGrant}</p> : null}
                <p>
                  The school stops being able to save immediately, and anything it
                  has not saved by then is refused. Its own lock and the
                  division-wide lock are unchanged — it goes back to whatever they
                  already said.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Keep it open</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={(e) => {
                // Radix closes on click unless this is prevented, and the dialog has
                // to survive a failure so the error above can be read.
                e.preventDefault();
                confirm();
              }}
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Close the window
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
