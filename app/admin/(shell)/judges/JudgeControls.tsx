"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Gavel, KeyRound, Loader2, MoreHorizontal, Pencil, UserMinus, UserPlus } from "lucide-react";

import type { JudgeRosterRow } from "@/components/admin/judging/JudgeRosterTable";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_JUDGE_PASSWORD, type JudgeInput } from "@/lib/judges/judge-input";

import {
  createJudgeAction,
  provisionJudgeLoginAction,
  setJudgeActiveAction,
  updateJudgeAction,
} from "./actions";

/**
 * The roster's write controls: add a judge, correct one, give one a login, and
 * take one off the roster.
 *
 * None of these decides anything. Each calls a `security definer` RPC from
 * migration 0029 that re-checks the whole rule inside the database
 * (non-negotiable 2), and those refusals are written as sentences an admin can
 * act on — "this judge is seated on 2 event(s); unseat them there first". So the
 * database's own words are what a reader ends up with, and they land *inline in
 * the open dialog* rather than in a toast, following `EventControls`: a refusal
 * is the only account of itself anyone gets, and it has to survive long enough to
 * be read and acted on.
 *
 * Kept in the route folder rather than under `components/admin/judging` because
 * every one of them imports `./actions`. `JudgeRosterTable` stays a plain server
 * component that imports no action and takes these through its `renderActions`
 * prop, so nothing in that file ships to the browser.
 */

/** The five fields `judges` holds, as the form carries them: blank, never null. */
const EMPTY_FORM: JudgeInput = {
  firstName: "",
  middleName: "",
  lastName: "",
  email: "",
  affiliation: "",
};

/**
 * The add and edit forms are the same five fields in the same order, and
 * `validateJudgeInput` complains about them in that order too, so the first
 * sentence an admin reads names the first field their eye reaches.
 */
function JudgeFields({
  value,
  onChange,
  disabled,
  emailNote,
}: {
  value: JudgeInput;
  onChange: (next: JudgeInput) => void;
  disabled: boolean;
  /** What the email field means here, which differs between adding and editing. */
  emailNote: string;
}) {
  const ids = {
    first: useId(),
    middle: useId(),
    last: useId(),
    email: useId(),
    affiliation: useId(),
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={ids.first}>First name</Label>
          <Input
            id={ids.first}
            value={value.firstName}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, firstName: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.last}>Last name</Label>
          <Input
            id={ids.last}
            value={value.lastName}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, lastName: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={ids.middle}>Middle name</Label>
        <Input
          id={ids.middle}
          value={value.middleName}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, middleName: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">Optional.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={ids.email}>Email</Label>
        <Input
          id={ids.email}
          type="email"
          value={value.email}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, email: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">{emailNote}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={ids.affiliation}>Affiliation</Label>
        <Input
          id={ids.affiliation}
          value={value.affiliation}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, affiliation: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Optional — the school, office or paper this judge comes from. A judge is never
          shown it, and neither is a contestant.
        </p>
      </div>
    </div>
  );
}

/** The inline refusal every dialog here shows, in the one place it is styled. */
function Refusal({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {error}
    </p>
  );
}

const EMAIL_NOTE_NEW =
  "Optional now, and required before this judge can be given a login — it is the address they sign in with. Two judges cannot share one.";

/**
 * Adds a judge, and stops there.
 *
 * No login is made with them, which is the opposite of `AddSchoolDialog`. A panel
 * is agreed in a meeting and the accounts follow (0018), so a judge on file with
 * no login is the ordinary state on the day the panel is drawn up rather than a
 * half-finished write — there is nothing here to roll back and nothing to repair.
 */
export function AddJudgeDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<JudgeInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function show(next: boolean) {
    setOpen(next);
    if (!next) {
      // Neither the last attempt's refusal nor a judge already added may still be
      // sitting in the form the next time this opens.
      setForm(EMPTY_FORM);
      setError(null);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createJudgeAction(form);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      toast.success(`${form.firstName.trim()} ${form.lastName.trim()} is on the roster.`);
      show(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => show(true)}>
        <Gavel />
        Add judge
      </Button>

      <Dialog open={open} onOpenChange={show}>
        <DialogContent>
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Add a judge</DialogTitle>
              <DialogDescription>
                This puts the judge on the roster. It does not make them a login and does
                not seat them anywhere — both are separate acts, and a judge on file with
                neither is the normal state before a contest.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <JudgeFields
                value={form}
                onChange={setForm}
                disabled={isPending}
                emailNote={EMAIL_NOTE_NEW}
              />
            </div>

            <Refusal error={error} />

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" disabled={isPending} onClick={() => show(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Add judge
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The three things that can be done to a judge already on the roster.
 *
 * A menu rather than the row of plain buttons `AccountRowActions` uses, because
 * there are three of them and two are rare: a roster of forty judges would
 * otherwise carry a hundred and twenty buttons, and the one an admin wants on any
 * given day is the one they came looking for.
 *
 * Deactivating is offered from here and nowhere else. It is a roster-wide act, and
 * an event's panel card offers seating instead — putting this beside those controls
 * would read as taking the judge off *that* event, which is what emptying their seat
 * does, and the two have different consequences.
 */
export function JudgeRowActions({ row }: { row: JudgeRosterRow }) {
  const router = useRouter();
  const passwordId = useId();

  const [open, setOpen] = useState<"edit" | "login" | "active" | null>(null);
  const [form, setForm] = useState<JudgeInput>(EMPTY_FORM);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function show(next: "edit" | "login" | "active" | null) {
    setOpen(next);
    setError(null);
    setPassword("");
    if (next === "edit") {
      // Seeded from the row every time it opens rather than held in state, so a
      // dialog closed on a refusal does not reopen holding the rejected values —
      // and so another admin's correction, arrived on the last refresh, is what
      // this one starts editing from.
      setForm({
        firstName: row.firstName,
        middleName: row.middleName ?? "",
        lastName: row.lastName,
        email: row.email ?? "",
        affiliation: row.affiliation ?? "",
      });
    }
  }

  function run(action: () => Promise<{ error: string } | void>, done: string) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      toast.success(done);
      show(null);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-8" disabled={isPending}>
            <MoreHorizontal />
            <span className="sr-only">Actions for {row.name}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => show("edit")}>
            <Pencil />
            Edit details
          </DropdownMenuItem>
          {row.hasLogin ? null : (
            <DropdownMenuItem onSelect={() => show("login")}>
              <KeyRound />
              Give a login
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant={row.isActive ? "destructive" : "default"}
            onSelect={() => show("active")}
          >
            {row.isActive ? <UserMinus /> : <UserPlus />}
            {row.isActive ? "Deactivate" : "Reactivate"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open === "edit"} onOpenChange={(next) => show(next ? "edit" : null)}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(() => updateJudgeAction(row.id, form), `${row.name}'s details are updated.`);
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit {row.name}</DialogTitle>
              <DialogDescription>
                Corrections to what the roster holds. Seats and sheets are untouched: this
                changes who the judge is on file as, not what they are judging.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <JudgeFields
                value={form}
                onChange={setForm}
                disabled={isPending}
                emailNote={
                  row.hasLogin
                    ? "This judge signs in with this address, and it cannot be changed here — the login it opens would stop matching. Change it where the login lives."
                    : EMAIL_NOTE_NEW
                }
              />
            </div>

            <Refusal error={error} />

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" disabled={isPending} onClick={() => show(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "login"} onOpenChange={(next) => show(next ? "login" : null)}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => provisionJudgeLoginAction(row.id, password),
                `${row.name} can now sign in at /judge/login.`
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>Give {row.name} a login</DialogTitle>
              <DialogDescription>
                They sign in at <code className="font-mono text-xs">/judge/login</code> with{" "}
                {row.email ? (
                  <span className="font-mono text-xs">{row.email}</span>
                ) : (
                  "the email address on their roster row"
                )}{" "}
                and the password set here. Nothing is emailed — no mail leaves this system —
                so this password has to be handed over in person.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 py-4">
              <Label htmlFor={passwordId}>Password</Label>
              <Input
                id={passwordId}
                type="text"
                autoComplete="off"
                value={password}
                disabled={isPending}
                onChange={(e) => setPassword(e.target.value)}
              />
              {/* Shown rather than masked, deliberately: an admin types this once and
                  reads it out to the judge, and a password nobody can check before
                  handing over is one that gets handed over wrong. */}
              <p className="text-xs text-muted-foreground">
                At least {MIN_JUDGE_PASSWORD} characters, and shown as you type so you can
                read it back. Write it down before saving — it cannot be read again here.
              </p>
            </div>

            <Refusal error={error} />

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" disabled={isPending} onClick={() => show(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || password === ""}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Create login
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={open === "active"} onOpenChange={(next) => show(next ? "active" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {row.isActive ? `Take ${row.name} off the roster?` : `Put ${row.name} back on?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {row.isActive
                ? "They stop being available to seat, and any sheet they have already submitted still counts — placements already resting on their ranks do not move. This is refused while they still hold a seat; unseat them on those events first."
                : "They become available to seat again. Nothing they judged before is affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Refusal error={error} />

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={row.isActive ? "destructive" : "default"}
              disabled={isPending}
              onClick={(event) => {
                // The dialog has to survive a failure so the refusal above can be
                // read, and Radix closes on click unless this is prevented.
                event.preventDefault();
                run(
                  () => setJudgeActiveAction(row.id, !row.isActive),
                  row.isActive
                    ? `${row.name} is off the roster.`
                    : `${row.name} is back on the roster.`
                );
              }}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              {row.isActive ? "Deactivate" : "Reactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
