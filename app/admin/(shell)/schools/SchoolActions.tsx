"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ClipboardPlus,
  Loader2,
  MoreHorizontal,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";

import {
  addSchoolCoachAction,
  addSchoolParticipantAction,
  createSchoolEntryAction,
  loadSchoolRosterAction,
  type SchoolRosterDetail,
} from "./actions";
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
import { capReason, maxCoachesFor, validateEntryCounts } from "@/lib/roster/limits";
import { eventOptionLabel } from "@/lib/roster/participant-move";

/**
 * The row menu on /admin/schools: put a learner, a coach or a whole entry into a
 * school's workspace on its behalf.
 *
 * For the school that never got its people on file at all — it missed the deadline,
 * lost its login, or sent the list on paper. Reopening that school is the right tool
 * when it can still do the work itself, and no use whatever when it cannot.
 *
 * ## Why the entry form re-uses the school's own rules
 *
 * `validateEntryCounts` and `capReason` are the functions the school's wizard calls,
 * imported here rather than re-stated. An entry an officer types must be one the
 * school's own form will still accept when it reopens; a second reading of the same
 * rules is free to drift, and the drift would show up as an entry the school can see
 * and cannot edit.
 */
export function SchoolActions({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"participant" | "coach" | "entry" | null>(null);
  const [detail, setDetail] = useState<SchoolRosterDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [, startRefresh] = useTransition();

  const load = useCallback(
    (next: "participant" | "coach" | "entry") => {
      setOpen(next);
      setLoadError(null);
      // The roster is only needed by the entry form, but it is cheap and reading it
      // for all three keeps one loading path rather than two that can disagree about
      // what "loaded" means.
      startLoading(async () => {
        const result = await loadSchoolRosterAction(schoolId);
        if ("error" in result) {
          setDetail(null);
          setLoadError(result.error);
          return;
        }
        setDetail(result.detail);
      });
    },
    [schoolId]
  );

  /**
   * Close and re-read the table. Owned here, by the component that stays mounted:
   * a refresh scheduled inside a dialog's own transition is dropped when that
   * dialog unmounts, which leaves a written row invisible until a manual reload.
   */
  const finish = useCallback(() => {
    setOpen(null);
    startRefresh(() => {
      router.refresh();
    });
  }, [router]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-8">
            <MoreHorizontal />
            <span className="sr-only">Actions for {schoolName}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => load("participant")}>
            <UserPlus />
            Add a learner
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => load("coach")}>
            <Users />
            Add a coach
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => load("entry")}>
            <ClipboardPlus />
            File an entry
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={open !== null}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      >
        <DialogContent
          className={
            open === "entry"
              ? "grid max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 sm:max-w-xl"
              : "grid max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 sm:max-w-md"
          }
        >
          {open === "entry" ? (
            <EntryBody
              schoolId={schoolId}
              schoolName={schoolName}
              detail={detail}
              isLoading={isLoading}
              loadError={loadError}
              onDone={finish}
            />
          ) : (
            <PersonBody
              kind={open === "coach" ? "coach" : "participant"}
              schoolId={schoolId}
              schoolName={schoolName}
              onDone={finish}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The warning both forms carry: this is somebody else's workspace. */
function OnBehalfNotice({ schoolName }: { schoolName: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <TriangleAlert className="size-4 shrink-0 translate-y-0.5 text-amber-600 dark:text-amber-500" />
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">This writes into {schoolName}&rsquo;s own
        records.</span>{" "}
        The school is not asked and is not notified, and will find it there the next time it
        signs in. Where the school can still do this itself, ask them to.
      </p>
    </div>
  );
}

/**
 * A learner or a coach. One component, because the two forms are the same four
 * fields and the same rules — `rosterParticipantSchema` and `rosterCoachSchema` are
 * the same shape — and two copies would be two places for a label to drift.
 */
function PersonBody({
  kind,
  schoolId,
  schoolName,
  onDone,
}: {
  kind: "participant" | "coach";
  schoolId: string;
  schoolName: string;
  onDone: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const noun = kind === "participant" ? "learner" : "coach";

  function submit() {
    setError(null);
    const input = { firstName, middleName, lastName, gender };
    startTransition(async () => {
      const result =
        kind === "participant"
          ? await addSchoolParticipantAction(schoolId, input)
          : await addSchoolCoachAction(schoolId, input);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(`${lastName}, ${firstName} was added to ${schoolName}.`);
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a {noun}</DialogTitle>
        <DialogDescription>
          {kind === "participant"
            ? `A learner on ${schoolName}'s roster. They are given the next division contestant number, and can be entered in an event afterwards.`
            : `A coach on ${schoolName}'s roster, available to any of its entries.`}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 space-y-4 overflow-y-auto py-4">
        <OnBehalfNotice schoolName={schoolName} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="person-first">First name</Label>
            <Input
              id="person-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="person-last">Last name</Label>
            <Input
              id="person-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="person-middle">Middle name</Label>
            <Input
              id="person-middle"
              value={middleName}
              onChange={(e) => setMiddleName(e.target.value)}
              disabled={isPending}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="person-gender">Gender</Label>
            <Select value={gender} onValueChange={(v) => setGender(v as "M" | "F")}>
              <SelectTrigger id="person-gender" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="M">M</SelectItem>
                <SelectItem value="F">F</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" disabled={isPending} onClick={onDone}>
          Cancel
        </Button>
        <Button
          disabled={isPending || !firstName.trim() || !lastName.trim()}
          onClick={submit}
        >
          {isPending && <Loader2 className="size-4 animate-spin" />}
          Add {noun}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * A whole entry: the contest, the contestants and their coaches.
 *
 * The same three questions the school's own wizard asks, in the same order, checked
 * by the same function. An individual entry pairs one coach with each contestant; a
 * group entry's coaches are the team's and are paired with nobody (0019), which is
 * why the coach control changes shape with the category rather than staying one
 * control that means different things.
 */
function EntryBody({
  schoolId,
  schoolName,
  detail,
  isLoading,
  loadError,
  onDone,
}: {
  schoolId: string;
  schoolName: string;
  detail: SchoolRosterDetail | null;
  isLoading: boolean;
  loadError: string | null;
  onDone: () => void;
}) {
  const [eventId, setEventId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  /** Individual: coach id per participant id. Group: the shared list. */
  const [pairing, setPairing] = useState<Record<string, string>>({});
  const [teamCoaches, setTeamCoaches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const events = useMemo(() => detail?.events ?? [], [detail]);
  const event = events.find((row) => row.id === eventId);

  const coaches = useMemo(
    () =>
      event
        ? event.category === "individual"
          ? picked.map((participantId) => ({
              coachId: pairing[participantId] ?? "",
              participantId,
            }))
          : teamCoaches.map((coachId) => ({ coachId, participantId: null }))
        : [],
    [event, picked, pairing, teamCoaches]
  );

  // The school's own rule, read by the school's own function. Reported before the
  // click rather than after the refusal.
  const invalid = useMemo(() => {
    if (!event) return "Choose an event.";
    if (coaches.some((coach) => !coach.coachId)) return "Choose a coach for every contestant.";
    return validateEntryCounts({
      category: event.category,
      participantIds: picked,
      coaches,
      minParticipants: event.minParticipants,
      maxParticipants: event.maxParticipants,
    });
  }, [event, picked, coaches]);

  function toggle(participantId: string) {
    setError(null);
    setPicked((current) =>
      current.includes(participantId)
        ? current.filter((id) => id !== participantId)
        : [...current, participantId]
    );
  }

  function submit() {
    if (!event) return;
    setError(null);
    startTransition(async () => {
      const result = await createSchoolEntryAction({
        schoolId,
        eventId: event.id,
        participantIds: picked,
        coaches,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(
        `${schoolName} is entered in ${event.name} with ${result.contestants} ${
          result.contestants === 1 ? "contestant" : "contestants"
        }.`
      );
      onDone();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>File an entry for {schoolName}</DialogTitle>
        <DialogDescription>
          The contest, who is in it, and who coaches them — the same three questions the
          school&rsquo;s own form asks, checked by the same rules.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 space-y-4 overflow-y-auto py-4">
        {loadError ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {loadError}
          </p>
        ) : null}
        {isLoading ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Reading this school&rsquo;s roster…
          </p>
        ) : null}

        {detail ? <OnBehalfNotice schoolName={schoolName} /> : null}

        {detail && detail.participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This school has nobody on its roster yet, so there is nobody to enter. Add a learner
            first — the menu this dialog came from does that too.
          </p>
        ) : null}

        {detail && detail.participants.length > 0 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="entry-event">Event</Label>
              <Select
                value={eventId}
                onValueChange={(value) => {
                  setEventId(value);
                  // The picks belong to the contest they were made for: a team of
                  // seven and a solo contest do not share an answer.
                  setPicked([]);
                  setPairing({});
                  setTeamCoaches([]);
                  setError(null);
                }}
              >
                <SelectTrigger id="entry-event" className="w-full">
                  <SelectValue placeholder="Choose an event" />
                </SelectTrigger>
                <SelectContent>
                  {events.map((row) => {
                    const filed = detail.filedEventIds.includes(row.id);
                    return (
                      <SelectItem key={row.id} value={row.id} disabled={filed}>
                        <span className="flex flex-col items-start gap-0.5">
                          <span>{eventOptionLabel(row)}</span>
                          {filed ? (
                            // Disabled rather than hidden: one entry per event per
                            // school is the school's rule, and the way to add
                            // somebody to the entry that exists is from the
                            // participants page.
                            <span className="text-xs">Already filed — add to it from a contestant</span>
                          ) : null}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            {event ? (
              <div className="space-y-2">
                <Label>
                  Contestants{" "}
                  <span className="font-normal text-muted-foreground">
                    ({picked.length} of{" "}
                    {event.maxParticipants === null
                      ? `${event.minParticipants} or more`
                      : event.minParticipants === event.maxParticipants
                        ? event.minParticipants
                        : `${event.minParticipants}–${event.maxParticipants}`}
                    )
                  </span>
                </Label>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                  {detail.participants.map((person) => {
                    // The cap is the school's, read by the school's own function, so a
                    // learner already in two individual contests is greyed out here
                    // rather than after the whole form is refused.
                    const capped = capReason(detail.usage[person.id], event.category);
                    const checked = picked.includes(person.id);
                    return (
                      <label
                        key={person.id}
                        className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm has-[:disabled]:opacity-50"
                      >
                        {/* A native input styled with the theme's accent, the way
                            AllowRevisionDialog does it: there is no checkbox in
                            components/ui, and one dialog is not a reason to add a
                            primitive. */}
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                          checked={checked}
                          disabled={!!capped && !checked}
                          onChange={() => toggle(person.id)}
                        />
                        <span className="flex flex-col">
                          <span>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {person.numberLabel}
                            </span>{" "}
                            {person.name}
                          </span>
                          {capped ? (
                            <span className="text-xs text-muted-foreground">{capped}</span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {event && detail.coaches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This school has no coaches on its roster, and every entry needs at least one.
                Add a coach first.
              </p>
            ) : null}

            {event && detail.coaches.length > 0 && event.category === "individual" ? (
              <div className="space-y-2">
                <Label>Coaches</Label>
                <p className="text-xs text-muted-foreground">
                  One per contestant. The same coach may take more than one of them, which is
                  the ordinary case for a small school.
                </p>
                {picked.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Choose a contestant first.</p>
                ) : null}
                {picked.map((participantId) => {
                  const person = detail.participants.find((p) => p.id === participantId);
                  return (
                    <div key={participantId} className="flex items-center gap-2">
                      <span className="w-40 shrink-0 truncate text-sm">{person?.name}</span>
                      <Select
                        value={pairing[participantId] ?? ""}
                        onValueChange={(value) =>
                          setPairing((current) => ({ ...current, [participantId]: value }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a coach" />
                        </SelectTrigger>
                        <SelectContent>
                          {detail.coaches.map((coach) => (
                            <SelectItem key={coach.id} value={coach.id}>
                              {coach.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {event && detail.coaches.length > 0 && event.category === "group" ? (
              <div className="space-y-2">
                <Label>
                  Coaches{" "}
                  <span className="font-normal text-muted-foreground">
                    ({teamCoaches.length} of at most {maxCoachesFor("group")})
                  </span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  A team shares its coaches, so none of them is matched to one member.
                </p>
                <div className="space-y-1 rounded-md border p-2">
                  {detail.coaches.map((coach) => {
                    const checked = teamCoaches.includes(coach.id);
                    return (
                      <label
                        key={coach.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm has-[:disabled]:opacity-50"
                      >
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 accent-primary"
                          checked={checked}
                          disabled={!checked && teamCoaches.length >= maxCoachesFor("group")}
                          onChange={() =>
                            setTeamCoaches((current) =>
                              current.includes(coach.id)
                                ? current.filter((id) => id !== coach.id)
                                : [...current, coach.id]
                            )
                          }
                        />
                        {coach.name}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {event && invalid && picked.length > 0 ? (
              <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">{invalid}</p>
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
        <Button variant="outline" disabled={isPending} onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={isPending || invalid !== null} onClick={submit}>
          {isPending && <Loader2 className="size-4 animate-spin" />}
          File entry
        </Button>
      </DialogFooter>
    </>
  );
}
