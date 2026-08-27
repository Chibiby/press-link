"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Armchair,
  Gavel,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LANGUAGE_LABEL, type EventLanguage, type EventLevel } from "@/lib/events-catalog";
import { MIN_JUDGE_PASSWORD, type JudgeInput } from "@/lib/judges/judge-input";
import {
  EMPTY_SEAT_CHOICE,
  seatPicker,
  type SeatableEvent,
  type SeatChoice,
} from "@/lib/judging/seat-picker";

import {
  assignJudgeAction,
  createJudgeAction,
  deleteJudgeAction,
  provisionJudgeLoginAction,
  setJudgeActiveAction,
  updateJudgeAction,
} from "./actions";

/**
 * The full word, for a dialog with room for it.
 *
 * The compact "Elem · Eng" form belongs to the index tables and lives in
 * `eventSlotLabel`. Here each half is its own question, so neither can be
 * abbreviated against the other.
 */
const LEVEL_LABEL: Record<EventLevel, string> = {
  elementary: "Elementary",
  secondary: "Secondary",
};

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

/** Which of a judge row's dialogs is open, if any. */
type JudgeDialog = "edit" | "login" | "active" | "seat" | "delete" | null;

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
 * The four things that can be done to a judge already on the roster.
 *
 * A menu rather than the row of plain buttons `AccountRowActions` uses: there are
 * four of them and most are rare, so a roster of forty judges would otherwise carry
 * a hundred and sixty buttons, and the one an admin wants on any given day is the
 * one they came looking for.
 *
 * Deactivating is offered from here and nowhere else. It is a roster-wide act, and
 * an event's panel card offers seating instead — putting this beside those controls
 * would read as taking the judge off *that* event, which is what emptying their seat
 * does, and the two have different consequences.
 *
 * ## Why seating is offered from both ends
 *
 * The panel page fills one event's four seats; this fills one judge's schedule
 * across contests. They write the same row through the same RPC, and which one an
 * admin reaches for is a question of what they have in front of them — an event
 * whose panel is short, or a judge who has agreed to take three contests. Neither
 * ordering can be made to serve the other without asking for the same answers in a
 * worse order.
 */
export function JudgeRowActions({
  row,
  events,
}: {
  row: JudgeRosterRow;
  /**
   * The individual events this judge could be seated on, with who is on each seat.
   * Group events are left out: they are ranked on one board and have no seats
   * (non-negotiable 6).
   */
  events: SeatableEvent[];
}) {
  const router = useRouter();
  const passwordId = useId();
  const seatIds = {
    contest: useId(),
    language: useId(),
    level: useId(),
    seat: useId(),
  };

  const [open, setOpen] = useState<JudgeDialog>(null);
  const [form, setForm] = useState<JudgeInput>(EMPTY_FORM);
  const [password, setPassword] = useState("");
  const [choice, setChoice] = useState<SeatChoice>(EMPTY_SEAT_CHOICE);
  const [seat, setSeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const picker = seatPicker(events, choice, row.id);

  function show(next: JudgeDialog) {
    setOpen(next);
    setError(null);
    setPassword("");
    setChoice(EMPTY_SEAT_CHOICE);
    setSeat("");
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

  /**
   * Answer one of the three narrowing questions, and forget the seat.
   *
   * The seat has to go with any of them. "Seat 2 · replacing Reyes, A." is a fact
   * about one event, and leaving it selected while the event underneath it changes
   * would carry a sentence the reader agreed to onto a panel it was never about —
   * silently, since seat 2 exists on every event and nothing would look wrong.
   *
   * The narrower *answers* are cleared by the callers rather than here, because
   * which ones go stale depends on which question was answered: a new contest may
   * not be run in the language already chosen, but a new level invalidates nothing.
   */
  function narrow(next: SeatChoice) {
    setChoice(next);
    setSeat("");
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
          {/* Offered even to a judge with no login yet. Seating and signing in are
              separate facts: a panel is agreed in a meeting and the accounts follow,
              so refusing to seat somebody until an account exists would invert the
              order the division actually works in. */}
          {row.isActive ? (
            <DropdownMenuItem onSelect={() => show("seat")}>
              <Armchair />
              Seat on an event
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant={row.isActive ? "destructive" : "default"}
            onSelect={() => show("active")}
          >
            {row.isActive ? <UserMinus /> : <UserPlus />}
            {row.isActive ? "Deactivate" : "Reactivate"}
          </DropdownMenuItem>
          {/* Offered only to a judge who has ranked nothing. The RPC refuses the
              rest, but a menu item that exists to be refused is worse than one
              that is not there: deactivating is what those judges need, and it is
              the line above. */}
          {row.submittedSheets === 0 ? (
            <DropdownMenuItem variant="destructive" onSelect={() => show("delete")}>
              <Trash2 />
              Delete judge
            </DropdownMenuItem>
          ) : null}
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

      <Dialog open={open === "seat"} onOpenChange={(next) => show(next ? "seat" : null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Seat {row.name} on an event</DialogTitle>
            <DialogDescription>
              A contest runs separately in English and in Filipino, and separately at
              each level, so all three answers together name one event. Seat 1 ranks
              round 1 alone and makes the cut; seats 2, 3 and 4 place the winners.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor={seatIds.contest}>Contest</Label>
              <Select
                value={choice.contest}
                disabled={isPending}
                onValueChange={(next) => narrow({ contest: next, language: "", level: "" })}
              >
                <SelectTrigger id={seatIds.contest} className="w-full">
                  <SelectValue placeholder="Choose a contest" />
                </SelectTrigger>
                <SelectContent>
                  {picker.contests.map((contest) => (
                    <SelectItem key={contest} value={contest}>
                      {contest}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={seatIds.language}>Language</Label>
                <Select
                  value={choice.language}
                  disabled={isPending || picker.languages.length === 0}
                  onValueChange={(next) =>
                    narrow({ ...choice, language: next as EventLanguage, level: "" })
                  }
                >
                  <SelectTrigger id={seatIds.language} className="w-full">
                    <SelectValue placeholder="Choose a language" />
                  </SelectTrigger>
                  <SelectContent>
                    {picker.languages.map((language) => (
                      <SelectItem key={language} value={language}>
                        {LANGUAGE_LABEL[language]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor={seatIds.level}>Level</Label>
                <Select
                  value={choice.level}
                  disabled={isPending || picker.levels.length === 0}
                  onValueChange={(next) => narrow({ ...choice, level: next as EventLevel })}
                >
                  <SelectTrigger id={seatIds.level} className="w-full">
                    <SelectValue placeholder="Choose a level" />
                  </SelectTrigger>
                  <SelectContent>
                    {picker.levels.map((level) => (
                      <SelectItem key={level} value={level}>
                        {LEVEL_LABEL[level]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={seatIds.seat}>Seat</Label>
              <Select
                value={seat}
                disabled={isPending || picker.event === null || picker.blocked !== null}
                onValueChange={setSeat}
              >
                <SelectTrigger id={seatIds.seat} className="w-full">
                  <SelectValue placeholder="Choose a seat" />
                </SelectTrigger>
                <SelectContent>
                  {picker.seats.map((option) => (
                    <SelectItem key={option.seat} value={String(option.seat)}>
                      {/* An occupied seat is offered rather than hidden: reseating is
                          how a panel gets corrected, and a seat that vanished from the
                          list would read as one this event does not have. */}
                      Seat {option.seat} · round {option.round}
                      {option.occupiedBy ? ` · replacing ${option.occupiedBy}` : " · vacant"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {picker.blocked ??
                  (picker.event === null
                    ? "Answer the three above and this event's four seats appear here."
                    : "Choosing a seat somebody is already on replaces them. Their sheets stay on the event until an admin clears them.")}
              </p>
            </div>
          </div>

          <Refusal error={error} />

          <DialogFooter>
            <Button variant="outline" disabled={isPending} onClick={() => show(null)}>
              Cancel
            </Button>
            <Button
              disabled={isPending || picker.event === null || picker.blocked !== null || seat === ""}
              onClick={() => {
                const eventId = picker.event?.eventId;
                if (!eventId) return;
                run(
                  () => assignJudgeAction(eventId, row.id, Number(seat)),
                  `${row.name} is on seat ${seat} of ${choice.contest}.`
                );
              }}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Seat judge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={open === "delete"} onOpenChange={(next) => show(next ? "delete" : null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {row.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes them from the roster for good, along with their login and any
              seat they hold. It is offered because they have not submitted a sheet, so
              nothing anybody has been placed on rests on their ranks.
              {row.events > 0
                ? ` They currently sit on ${row.events} ${
                    row.events === 1 ? "event" : "events"
                  }, and those seats are emptied.`
                : ""}{" "}
              To retire a judge who <em>has</em> judged, deactivate them instead &mdash;
              their ranks have to stay.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Refusal error={error} />

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={(event) => {
                // The dialog has to survive a failure so the refusal above can be
                // read, and Radix closes on click unless this is prevented.
                event.preventDefault();
                run(() => deleteJudgeAction(row.id), `${row.name} was deleted.`);
              }}
            >
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Delete judge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
