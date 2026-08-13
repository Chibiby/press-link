"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Plus, Trash2, User, Users } from "lucide-react";

import { saveEntryAction } from "./actions";
import {
  languagesFor,
  levelsForType,
  resolveEvent,
  typeLabel,
  typesForCategory,
  type EventRow,
  type EventTypeRow,
} from "./wizard-steps";
import type { EntryRow, RosterCoach, RosterParticipant } from "./types";
import { entrySchema } from "@/lib/validation/entry";
import {
  capReason,
  maxCoachesFor,
  validateEntryCounts,
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

const STEP_LABELS = ["Category", "Event", "Level", "Language", "Details"];

export function EntryWizard({
  open,
  onOpenChange,
  types,
  events,
  participants,
  coaches,
  usage,
  entry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: EventTypeRow[];
  events: EventRow[];
  participants: RosterParticipant[];
  coaches: RosterCoach[];
  usage: UsageMap;
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
      setParticipantIds(entry.participants.map((p) => p.id));
      setCoachIds(entry.coaches.length > 0 ? entry.coaches.map((c) => c.id) : [UNSET]);
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

  const availableTypes = useMemo(
    () => (category ? typesForCategory(types, category) : []),
    [types, category]
  );
  const availableLevels = useMemo(
    () => (typeId ? levelsForType(events, typeId) : []),
    [events, typeId]
  );
  const availableLanguages = useMemo(
    () => (typeId && level ? languagesFor(events, typeId, level) : []),
    [events, typeId, level]
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
  const maxCoaches = maxCoachesFor(effectiveCategory, Math.max(chosenParticipants.length, 1));

  function chooseCategory(next: EventCategory) {
    setCategory(next);
    setTypeId(null);
    setLevel(null);
    setLanguage(null);
    setStep(2);
  }

  function chooseType(nextTypeId: string) {
    setTypeId(nextTypeId);
    setLanguage(null);
    const levels = levelsForType(events, nextTypeId);
    if (levels.length === 1) {
      // Secondary-only contests (MOJO, Online Publishing, both TV events) have
      // no real choice here — skip step 3 rather than showing a dead option.
      setLevel(levels[0]);
      setStep(4);
    } else {
      setLevel(null);
      setStep(3);
    }
  }

  function chooseLevel(next: EventLevel) {
    setLevel(next);
    setStep(4);
  }

  function chooseLanguage(next: EventLanguage) {
    setLanguage(next);
    // Open with exactly the rows the contest requires — a 7-member group event
    // should not make the user press Add six times.
    const required = types.find((t) => t.id === typeId)?.min_participants ?? 1;
    setParticipantIds((prev) => {
      const filled = prev.filter((id) => id !== UNSET);
      const rows = [...filled];
      while (rows.length < required) rows.push(UNSET);
      return rows.length === 0 ? [UNSET] : rows;
    });
    setStep(5);
  }

  function goBack() {
    setError(null);
    if (step === 5) {
      setStep(4);
    } else if (step === 4) {
      // Mirror the forward skip: don't land on a single-option level step.
      setStep(availableLevels.length === 1 ? 2 : 3);
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
      coachIds: chosenCoaches,
    };

    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    const countError = validateEntryCounts({
      category: effectiveCategory,
      participantIds: chosenParticipants,
      coachIds: chosenCoaches,
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
            {availableTypes.map((type) => {
              const label = typeLabel(type);
              return (
                <ChoiceCard
                  key={type.id}
                  title={label.primary}
                  hint={label.secondary}
                  selected={typeId === type.id}
                  onClick={() => chooseType(type.id)}
                />
              );
            })}
          </ChoiceGrid>
        )}

        {step === 3 && (
          <ChoiceGrid>
            {availableLevels.map((lvl) => (
              <ChoiceCard
                key={lvl}
                title={lvl === "elementary" ? "Elementary" : "Secondary"}
                selected={level === lvl}
                onClick={() => chooseLevel(lvl)}
              />
            ))}
          </ChoiceGrid>
        )}

        {step === 4 && (
          <ChoiceGrid>
            {availableLanguages.map((lang) => (
              <ChoiceCard
                key={lang}
                title={lang === "english" ? "English" : "Filipino"}
                hint={
                  lang === "filipino" && selectedType && selectedType.name_fil !== selectedType.name_en
                    ? selectedType.name_fil
                    : undefined
                }
                selected={language === lang}
                onClick={() => chooseLanguage(lang)}
              />
            ))}
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
                {(maxParticipants === null || participantIds.length < maxParticipants) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setParticipantIds((prev) => [...prev, UNSET])}
                  >
                    <Plus className="size-4" />
                    Add participant
                  </Button>
                )}
              </div>

              {participantIds.map((selected, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Label className="sr-only" htmlFor={`participant-slot-${i}`}>
                    Participant {i + 1}
                  </Label>
                  <Select
                    value={selected}
                    onValueChange={(value) =>
                      setParticipantIds((prev) =>
                        prev.map((row, idx) => (idx === i ? value : row))
                      )
                    }
                  >
                    <SelectTrigger id={`participant-slot-${i}`} className="w-full">
                      <SelectValue placeholder={`Select participant ${i + 1}`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Select participant {i + 1}</SelectItem>
                      {participants.map((participant) => {
                        const alreadyHere =
                          participant.id !== selected &&
                          chosenParticipants.includes(participant.id);
                        // Editing an entry must not count that entry against its
                        // own members, so anyone already on it stays selectable.
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
                      aria-label={`Remove participant ${i + 1}`}
                      onClick={() =>
                        setParticipantIds((prev) => prev.filter((_, idx) => idx !== i))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
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
                    onClick={() => setCoachIds((prev) => [...prev, UNSET])}
                  >
                    <Plus className="size-4" />
                    Add coach
                  </Button>
                )}
              </div>

              {coachIds.map((selected, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Label className="sr-only" htmlFor={`coach-slot-${i}`}>
                    Coach {i + 1}
                  </Label>
                  <Select
                    value={selected}
                    onValueChange={(value) =>
                      setCoachIds((prev) => prev.map((row, idx) => (idx === i ? value : row)))
                    }
                  >
                    <SelectTrigger id={`coach-slot-${i}`} className="w-full">
                      <SelectValue placeholder={`Select coach ${i + 1}`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Select coach {i + 1}</SelectItem>
                      {coaches.map((coach) => {
                        const alreadyHere =
                          coach.id !== selected && chosenCoaches.includes(coach.id);
                        return (
                          <SelectItem key={coach.id} value={coach.id} disabled={alreadyHere}>
                            {coach.full_name}
                            {alreadyHere ? " — already added" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {coachIds.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove coach ${i + 1}`}
                      onClick={() => setCoachIds((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </section>
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
  onClick,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
        "hover:border-primary/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary bg-accent"
      )}
    >
      {icon ? <span className="mt-0.5 text-primary">{icon}</span> : null}
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </button>
  );
}
