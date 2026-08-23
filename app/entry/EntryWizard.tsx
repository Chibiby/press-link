"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Plus, Trash2, User, Users } from "lucide-react";

import { saveEntryAction } from "./actions";
import {
  isEventTaken,
  isEveryEventTaken,
  languagesFor,
  levelsFor,
  resolveEvent,
  takenEventIdsFor,
  typeLabel,
  typesFor,
  type EventRow,
  type EventTypeRow,
} from "./wizard-steps";
import type { EntryRow, RosterCoach, RosterParticipant } from "./types";
import { entrySchema } from "@/lib/validation/entry";
import {
  capReason,
  maxCoachesFor,
  validateEntryCounts,
  type EntryCoach,
  type UsageMap,
} from "@/lib/roster/limits";
import type { EventCategory, EventLanguage, EventLevel } from "@/lib/events-catalog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

/** Radix Select forbids an empty item value, so this stands in for "unfilled". */
const UNSET = "__unset__";

// Level and language come before the contest so the Event step names one exact
// `events` row — which is what lets it grey out the ones already submitted.
const STEP_LABELS = ["Category", "Level", "Language", "Event", "Details"];

export function EntryWizard({
  open,
  onOpenChange,
  types,
  events,
  participants,
  coaches,
  usage,
  entries,
  entry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: EventTypeRow[];
  events: EventRow[];
  participants: RosterParticipant[];
  coaches: RosterCoach[];
  usage: UsageMap;
  /** Every entry this school already has, so used-up events can be greyed out. */
  entries: EntryRow[];
  /** When present the wizard edits this entry instead of creating one. */
  entry?: EntryRow | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<EventCategory | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [level, setLevel] = useState<EventLevel | null>(null);
  const [language, setLanguage] = useState<EventLanguage | null>(null);
  /** One slot per picker row; UNSET means the row is still empty. */
  const [participantIds, setParticipantIds] = useState<string[]>([UNSET]);
  const [coachIds, setCoachIds] = useState<string[]>([UNSET]);
  const [error, setError] = useState<string | null>(null);

  // Reset (or prefill from `entry`) every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (entry) {
      const type = types.find((t) => t.id === entry.event_type_id) ?? null;
      setCategory(type?.category ?? null);
      setTypeId(entry.event_type_id);
      setLevel(entry.level);
      setLanguage(entry.language);
      const savedParticipants = entry.participants.map((p) => p.id);
      // An individual entry reads back one coach per contestant, in the order
      // the contestants are listed. An entry filed before the pairing existed
      // has nothing to read back, so every coach row opens empty and the school
      // says who coaches whom — see `coachingPending`.
      const savedCoaches =
        (type?.category ?? "individual") === "individual"
          ? savedParticipants.map((id) => entry.coachByParticipant[id] ?? UNSET)
          : entry.coaches.map((c) => c.id);
      setParticipantIds(savedParticipants);
      setCoachIds(savedCoaches.length > 0 ? savedCoaches : [UNSET]);
      setStep(5);
    } else {
      setCategory(null);
      setTypeId(null);
      setLevel(null);
      setLanguage(null);
      setParticipantIds([UNSET]);
      setCoachIds([UNSET]);
      setStep(1);
    }
  }, [open, entry, types]);

  const availableLevels = useMemo(
    () => (category ? levelsFor(events, category) : []),
    [events, category]
  );
  const availableLanguages = useMemo(
    () => (category && level ? languagesFor(events, category, level) : []),
    [events, category, level]
  );
  const availableTypes = useMemo(
    () =>
      category && level && language
        ? typesFor(types, events, category, level, language)
        : [],
    [types, events, category, level, language]
  );
  /**
   * A school gets one entry per event, so anything it has already submitted is
   * shown greyed out rather than hidden — "already submitted" reads better than
   * a contest that silently vanished. The entry being edited is excluded so it
   * never blocks itself.
   */
  const taken = useMemo(
    () => takenEventIdsFor(entries, entry?.id ?? null),
    [entries, entry]
  );
  const selectedType = types.find((t) => t.id === typeId) ?? null;
  const resolved =
    typeId && level && language ? resolveEvent(events, typeId, level, language) : undefined;

  const effectiveCategory: EventCategory = selectedType?.category ?? category ?? "individual";
  const minParticipants = selectedType?.min_participants ?? 1;
  const maxParticipants = selectedType?.max_participants ?? null;

  /** Ids this entry already holds, so a person cannot be picked into two rows. */
  const chosenParticipants = participantIds.filter((id) => id !== UNSET);
  const chosenCoaches = coachIds.filter((id) => id !== UNSET);
  const maxCoaches = maxCoachesFor(effectiveCategory);

  /**
   * What is saved: every coach with the contestant they are for.
   *
   * An individual entry pairs by row — the coach in row 2 is for the contestant
   * in row 2 — and a row missing either half is not a pairing, so it is left out
   * and the count check reports the gap rather than saving half of one. A group
   * entry's coaches belong to the whole team, so they are paired with nobody.
   */
  const coachPairs: EntryCoach[] =
    effectiveCategory === "individual"
      ? participantIds.flatMap((participantId, index) => {
          const coachId = coachIds[index] ?? UNSET;
          return participantId === UNSET || coachId === UNSET
            ? []
            : [{ coachId, participantId }];
        })
      : chosenCoaches.map((coachId) => ({ coachId, participantId: null }));

  function chooseCategory(next: EventCategory) {
    setCategory(next);
    setTypeId(null);
    setLanguage(null);
    const levels = levelsFor(events, next);
    if (levels.length === 1) {
      // A category held at a single level has no real choice here — skip step 2
      // rather than showing a dead option.
      setLevel(levels[0]);
      setStep(3);
    } else {
      setLevel(null);
      setStep(2);
    }
  }

  function chooseLevel(next: EventLevel) {
    setLevel(next);
    setTypeId(null);
    setStep(3);
  }

  function chooseLanguage(next: EventLanguage) {
    setLanguage(next);
    setTypeId(null);
    setStep(4);
  }

  function chooseType(nextTypeId: string) {
    setTypeId(nextTypeId);
    const newType = types.find((t) => t.id === nextTypeId) ?? null;
    // Open with exactly the rows the contest requires — a 7-member group event
    // should not make the user press Add six times.
    const required = newType?.min_participants ?? 1;
    const newMaxParticipants = newType?.max_participants ?? null;

    // Switching to a smaller contest must not leave unsatisfiable rows
    // behind — clamp down to the new max (keeping the earliest picks)
    // before padding back up to the new min. Computed from current state
    // directly (not inside the setter) so the coach clamp below can use
    // the resulting count without depending on updater-callback timing.
    let filledParticipants = participantIds.filter((id) => id !== UNSET);
    if (newMaxParticipants !== null && filledParticipants.length > newMaxParticipants) {
      filledParticipants = filledParticipants.slice(0, newMaxParticipants);
    }
    const participantRows = [...filledParticipants];
    while (participantRows.length < required) participantRows.push(UNSET);
    setParticipantIds(participantRows.length === 0 ? [UNSET] : participantRows);

    const newCategory: EventCategory = newType?.category ?? category ?? "individual";
    const newMaxCoaches = maxCoachesFor(newCategory);
    let coachRows = coachIds.filter((id) => id !== UNSET);
    if (coachRows.length > newMaxCoaches) {
      coachRows = coachRows.slice(0, newMaxCoaches);
    }
    if (newCategory === "individual") {
      // One coach each, so the coach rows are the participant rows: cut the
      // extras a larger contest left behind as well as opening the missing ones.
      coachRows = coachRows.slice(0, participantRows.length);
      while (coachRows.length < participantRows.length) coachRows.push(UNSET);
    } else if (coachRows.length === 0) {
      coachRows.push(UNSET);
    }
    setCoachIds(coachRows);

    setStep(5);
  }

  function goBack() {
    setError(null);
    if (step === 3) {
      // Mirror the forward skip: don't land on a single-option level step.
      setStep(availableLevels.length === 1 ? 1 : 2);
    } else if (step > 1) {
      setStep(step - 1);
    }
  }

  function handleSave() {
    setError(null);
    if (!resolved) {
      setError("Pick an event before saving.");
      return;
    }

    const input = {
      eventId: resolved.id,
      participantIds: chosenParticipants,
      coaches: coachPairs,
    };

    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    const countError = validateEntryCounts({
      category: effectiveCategory,
      participantIds: chosenParticipants,
      coaches: coachPairs,
      minParticipants,
      maxParticipants,
    });
    if (countError) {
      setError(countError);
      return;
    }

    startTransition(async () => {
      const result = await saveEntryAction(entry?.id ?? null, input);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(entry ? "Entry updated." : "Entry added.");
      onOpenChange(false);
      router.refresh();
    });
  }

  /**
   * An individual contest is prepared one contestant at a time: a school picks
   * who competes and, in the same breath, who coaches them. So the two fields are
   * paired — a participant with its coach directly beneath it — instead of every
   * participant first and every coach after. Adding a participant opens the coach
   * row that goes with it.
   *
   * The pairing is a way through the form, not a fact in the database:
   * entry_participants and entry_coaches are independent link tables, so an entry
   * names a set of contestants and a set of coaches with nothing tying one to the
   * other. That is why coaches stay numbered instead of being labelled with a
   * contestant's name, and why the read-only View dialog keeps its two lists.
   */
  const paired = effectiveCategory === "individual";

  /**
   * The coaches offered in a pair row.
   *
   * An entry still waiting to be paired is being re-filed, not re-staffed: its
   * coaches are already on record and the only open question is which contestant
   * each one is for. Offering the school's whole roster there would invite a
   * fourth name onto an entry that has three. Every other row offers everyone.
   */
  const coachOptions = paired && entry?.coachingPending ? entry.coaches : coaches;
  const pairRows = Math.max(participantIds.length, coachIds.length);

  function addParticipantRow() {
    setParticipantIds((prev) => [...prev, UNSET]);
    // The coach field that comes with a new contestant. One coach each, so the
    // two lists move together and neither can run ahead of the other.
    if (paired) setCoachIds((prev) => [...prev, UNSET]);
  }

  function removeParticipantRow(index: number) {
    setParticipantIds((prev) => prev.filter((_, i) => i !== index));
    // A pair goes as a pair: dropping a contestant drops their coach field, not
    // the coach beneath the next contestant.
    if (paired) setCoachIds((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * Group entries only. Their coaches are a list the team shares, so it is added
   * to on its own; on an individual entry a coach field arrives with a
   * contestant and never by itself.
   */
  function addCoachRow() {
    setCoachIds((prev) => [...prev, UNSET]);
  }

  function removeCoachRow(index: number) {
    setCoachIds((prev) => prev.filter((_, i) => i !== index));
  }

  function participantSlot(index: number, selected: string) {
    return (
      <div className="flex items-center gap-2">
        <Label className="sr-only" htmlFor={`participant-slot-${index}`}>
          Participant {index + 1}
        </Label>
        <Select
          value={selected}
          onValueChange={(value) =>
            setParticipantIds((prev) =>
              prev.map((row, idx) => (idx === index ? value : row))
            )
          }
        >
          <SelectTrigger id={`participant-slot-${index}`} className="w-full">
            <SelectValue placeholder={`Select participant ${index + 1}`} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Select participant {index + 1}</SelectItem>
            {participants.map((participant) => {
              const alreadyHere =
                participant.id !== selected &&
                chosenParticipants.includes(participant.id);
              // Editing an entry must not count that entry against its own
              // members, so anyone already on it stays selectable.
              const onThisEntry = Boolean(
                entry?.participants.some((p) => p.id === participant.id)
              );
              const reason = onThisEntry
                ? null
                : capReason(usage[participant.id], effectiveCategory);
              const disabled = alreadyHere || reason !== null;
              return (
                <SelectItem
                  key={participant.id}
                  value={participant.id}
                  disabled={disabled}
                >
                  {participant.number_label} · {participant.full_name}
                  {reason ? ` — ${reason}` : alreadyHere ? " — already added" : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {participantIds.length > minParticipants && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove participant ${index + 1}`}
            onClick={() => removeParticipantRow(index)}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    );
  }

  function coachSlot(index: number, selected: string) {
    return (
      <div
        className={cn(
          "flex items-center gap-2",
          // Ruled off from the contestant above so the pair reads as one block.
          paired && "border-t pt-2"
        )}
      >
        <Label
          htmlFor={`coach-slot-${index}`}
          className={cn(
            "shrink-0 text-xs font-normal text-muted-foreground",
            // A filled pair is otherwise two names with nothing to tell them
            // apart. Under the two-list layout the heading already does that.
            !paired && "sr-only"
          )}
        >
          Coach{paired ? "" : " " + (index + 1)}
        </Label>
        <Select
          value={selected}
          onValueChange={(value) =>
            setCoachIds((prev) => prev.map((row, idx) => (idx === index ? value : row)))
          }
        >
          <SelectTrigger id={`coach-slot-${index}`} className="w-full">
            <SelectValue placeholder={paired ? "Select coach" : `Select coach ${index + 1}`} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>
              {paired ? "Select coach" : `Select coach ${index + 1}`}
            </SelectItem>
            {coachOptions.map((coach) => {
              // One coach may take more than one contestant in the same contest,
              // which is common enough that a school sends one for all three. So
              // on a pair row a name already chosen stays open; on a group entry,
              // where the coaches are one shared list, it does not.
              const alreadyHere =
                !paired && coach.id !== selected && chosenCoaches.includes(coach.id);
              return (
                <SelectItem key={coach.id} value={coach.id} disabled={alreadyHere}>
                  {coach.full_name}
                  {alreadyHere ? " — already added" : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {/* A contestant must have a coach, so a pair row has nothing to remove —
            it goes when the contestant does. To change the answer, pick another
            name; to clear it, pick "Select coach". */}
        {!paired && coachIds.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove coach ${index + 1}`}
            onClick={() => removeCoachRow(index)}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? "Edit entry" : "New entry"}</DialogTitle>
          <DialogDescription>
            {step === 5
              ? "Who is competing, and who is coaching them?"
              : `Step ${step} of 5 — ${STEP_LABELS[step - 1]}`}
          </DialogDescription>
        </DialogHeader>

        <StepIndicator step={step} />

        {step === 1 && (
          <ChoiceGrid>
            <ChoiceCard
              icon={<User className="size-5" />}
              title="Individual"
              hint="One contestant — writing, cartooning, photojournalism, MOJO"
              selected={category === "individual"}
              onClick={() => chooseCategory("individual")}
            />
            <ChoiceCard
              icon={<Users className="size-5" />}
              title="Group"
              hint="A team — broadcasting, collaborative and online publishing"
              selected={category === "group"}
              onClick={() => chooseCategory("group")}
            />
          </ChoiceGrid>
        )}

        {step === 2 && (
          <ChoiceGrid>
            {availableLevels.map((lvl) => (
              <ChoiceCard
                key={lvl}
                title={lvl === "elementary" ? "Elementary" : "Secondary"}
                selected={level === lvl}
                disabled={
                  category
                    ? isEveryEventTaken(events, { category, level: lvl }, taken)
                    : false
                }
                onClick={() => chooseLevel(lvl)}
              />
            ))}
          </ChoiceGrid>
        )}

        {step === 3 && (
          <ChoiceGrid>
            {availableLanguages.map((lang) => (
              <ChoiceCard
                key={lang}
                title={lang === "english" ? "English" : "Filipino"}
                selected={language === lang}
                disabled={
                  category && level
                    ? isEveryEventTaken(events, { category, level, language: lang }, taken)
                    : false
                }
                onClick={() => chooseLanguage(lang)}
              />
            ))}
          </ChoiceGrid>
        )}

        {step === 4 && (
          <ChoiceGrid>
            {availableTypes.map((type) => {
              const label = typeLabel(type);
              return (
                <ChoiceCard
                  key={type.id}
                  // At this step the level and language are already fixed, so a
                  // Filipino contest is best named by its Filipino title.
                  title={language === "filipino" ? type.name_fil : label.primary}
                  hint={language === "filipino" ? undefined : label.secondary}
                  selected={typeId === type.id}
                  disabled={
                    level && language
                      ? isEventTaken(events, type.id, level, language, taken)
                      : false
                  }
                  onClick={() => chooseType(type.id)}
                />
              );
            })}
          </ChoiceGrid>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="font-medium">{resolved?.name ?? "—"}</span>
              <span className="text-muted-foreground">
                · {level === "secondary" ? "Secondary" : "Elementary"} ·{" "}
                {language === "filipino" ? "Filipino" : "English"}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => setStep(1)}
              >
                Change event
              </Button>
            </div>

            {paired ? (
              <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    Contestants and coaches{" "}
                    {/* Kept on one line: a 390px screen otherwise breaks the
                        range apart and leaves "3)" stranded under the heading. */}
                    <span className="font-normal whitespace-nowrap text-muted-foreground">
                      ({maxParticipants === null
                        ? `at least ${minParticipants}`
                        : minParticipants === maxParticipants
                          ? `exactly ${minParticipants}`
                          : `${minParticipants}–${maxParticipants}`}
                      )
                    </span>
                  </h3>
                  {(maxParticipants === null ||
                    participantIds.length < maxParticipants) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addParticipantRow}
                    >
                      <Plus className="size-4" />
                      Add participant
                    </Button>
                  )}
                </div>

                {entry?.coachingPending && (
                  <Alert>
                    <AlertDescription>
                      This entry was filed before contestants and coaches were
                      matched up, so the coach fields start empty. Choose from the
                      coaches already on this entry. A coach you leave unmatched is
                      dropped when you save.
                    </AlertDescription>
                  </Alert>
                )}

                {Array.from({ length: pairRows }, (_, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-xl border p-3">
                    {i < participantIds.length && participantSlot(i, participantIds[i])}
                    {i < coachIds.length && coachSlot(i, coachIds[i])}
                  </div>
                ))}
              </section>
            ) : (
              <>
                {/* A seven-member team shares two coaches, so pairing them off
                    would be a fiction. Group entries keep the two lists. */}
                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                      Participants{" "}
                      <span className="font-normal text-muted-foreground">
                        ({maxParticipants === null
                          ? `at least ${minParticipants}`
                          : minParticipants === maxParticipants
                            ? `exactly ${minParticipants}`
                            : `${minParticipants}–${maxParticipants}`}
                        )
                      </span>
                    </h3>
                    {(maxParticipants === null ||
                      participantIds.length < maxParticipants) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addParticipantRow}
                      >
                        <Plus className="size-4" />
                        Add participant
                      </Button>
                    )}
                  </div>

                  {participantIds.map((selected, i) => (
                    <div key={i}>{participantSlot(i, selected)}</div>
                  ))}
                </section>

                <Separator />

                <section className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">
                      Coaches{" "}
                      <span className="font-normal text-muted-foreground">
                        (1{maxCoaches > 1 ? `–${maxCoaches}` : ""})
                      </span>
                    </h3>
                    {coachIds.length < maxCoaches && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addCoachRow}
                      >
                        <Plus className="size-4" />
                        Add coach
                      </Button>
                    )}
                  </div>

                  {coachIds.map((selected, i) => (
                    <div key={i}>{coachSlot(i, selected)}</div>
                  ))}
                </section>
              </>
            )}
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          {step > 1 ? (
            <Button type="button" variant="ghost" onClick={goBack} disabled={isPending}>
              <ArrowLeft className="size-4" />
              Back
            </Button>
          ) : (
            <span />
          )}
          {step === 5 && (
            <Button type="button" onClick={handleSave} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="size-4" />
                  {entry ? "Save changes" : "Save entry"}
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label="Progress">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li key={label} className="flex flex-1 flex-col gap-1.5">
            <span
              className={cn(
                "h-1.5 rounded-full transition-colors",
                state === "todo" ? "bg-border" : "bg-primary"
              )}
            />
            <span
              className={cn(
                "text-[11px]",
                state === "current" ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ChoiceGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function ChoiceCard({
  icon,
  title,
  hint,
  selected,
  disabled,
  onClick,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  selected?: boolean;
  /** Already submitted by this school — shown, but not pickable. */
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        "hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary bg-accent",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      {icon ? <span className="mt-0.5 text-primary">{icon}</span> : null}
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
        {disabled ? (
          <span className="text-xs font-medium text-muted-foreground">Already submitted</span>
        ) : null}
      </span>
    </button>
  );
}
