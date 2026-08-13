"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Loader2,
  Plus,
  Trash2,
  User,
  Users,
} from "lucide-react";

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
import type { EntryRow } from "./types";
import { entrySchema } from "@/lib/validation/entry";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface ParticipantDraft {
  firstName: string;
  middleName: string;
  lastName: string;
  gender: "M" | "F";
}

interface CoachDraft {
  fullName: string;
  gender: "M" | "F";
}

const emptyParticipant = (): ParticipantDraft => ({
  firstName: "",
  middleName: "",
  lastName: "",
  gender: "M",
});

const emptyCoach = (): CoachDraft => ({ fullName: "", gender: "M" });

const STEP_LABELS = ["Category", "Event", "Level", "Language", "Details"];

export function EntryWizard({
  open,
  onOpenChange,
  types,
  events,
  entry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: EventTypeRow[];
  events: EventRow[];
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
  const [participants, setParticipants] = useState<ParticipantDraft[]>([emptyParticipant()]);
  const [coaches, setCoaches] = useState<CoachDraft[]>([emptyCoach()]);
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
      setParticipants(
        entry.participants.map((p) => ({
          firstName: p.first_name,
          middleName: p.middle_name ?? "",
          lastName: p.last_name,
          gender: p.gender,
        }))
      );
      setCoaches(
        entry.coaches.length > 0
          ? entry.coaches.map((c) => ({ fullName: c.full_name, gender: c.gender }))
          : [emptyCoach()]
      );
      setStep(5);
    } else {
      setCategory(null);
      setTypeId(null);
      setLevel(null);
      setLanguage(null);
      setParticipants([emptyParticipant()]);
      setCoaches([emptyCoach()]);
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
    const nextCategory = selectedType?.category ?? category;
    // Group events need at least two participants — start with the rows the
    // form actually requires instead of making the user discover the rule.
    setParticipants((prev) =>
      nextCategory === "group"
        ? prev.length >= 2
          ? prev
          : [...prev, ...Array(2 - prev.length).fill(null).map(emptyParticipant)]
        : prev.slice(0, 1)
    );
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
      category: resolved.category,
      participants: participants.map((p) => ({
        firstName: p.firstName,
        middleName: p.middleName || undefined,
        lastName: p.lastName,
        gender: p.gender,
      })),
      coaches: coaches.map((c) => ({ fullName: c.fullName, gender: c.gender })),
    };

    const parsed = entrySchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
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

  const isGroup = (selectedType?.category ?? category) === "group";
  const minParticipants = isGroup ? 2 : 1;

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

            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Participants{" "}
                  <span className="font-normal text-muted-foreground">
                    ({isGroup ? "at least 2" : "exactly 1"})
                  </span>
                </h3>
                {isGroup && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setParticipants((p) => [...p, emptyParticipant()])}
                  >
                    <Plus className="size-4" />
                    Add participant
                  </Button>
                )}
              </div>

              {participants.map((p, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Participant {i + 1}
                    </span>
                    {participants.length > minParticipants && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setParticipants((prev) => prev.filter((_, idx) => idx !== i))
                        }
                      >
                        <Trash2 className="size-4" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="First name">
                      <Input
                        value={p.firstName}
                        onChange={(e) =>
                          setParticipants((prev) =>
                            prev.map((row, idx) =>
                              idx === i ? { ...row, firstName: e.target.value } : row
                            )
                          )
                        }
                      />
                    </Field>
                    <Field label="Middle name">
                      <Input
                        value={p.middleName}
                        onChange={(e) =>
                          setParticipants((prev) =>
                            prev.map((row, idx) =>
                              idx === i ? { ...row, middleName: e.target.value } : row
                            )
                          )
                        }
                      />
                    </Field>
                    <Field label="Last name">
                      <Input
                        value={p.lastName}
                        onChange={(e) =>
                          setParticipants((prev) =>
                            prev.map((row, idx) =>
                              idx === i ? { ...row, lastName: e.target.value } : row
                            )
                          )
                        }
                      />
                    </Field>
                  </div>
                  <GenderPicker
                    name={`participant-gender-${i}`}
                    value={p.gender}
                    onChange={(gender) =>
                      setParticipants((prev) =>
                        prev.map((row, idx) => (idx === i ? { ...row, gender } : row))
                      )
                    }
                  />
                </div>
              ))}
            </section>

            <Separator />

            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  Coaches{" "}
                  <span className="font-normal text-muted-foreground">(1 or 2)</span>
                </h3>
                {coaches.length < 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCoaches((c) => [...c, emptyCoach()])}
                  >
                    <Plus className="size-4" />
                    Add coach
                  </Button>
                )}
              </div>

              {coaches.map((c, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      Coach {i + 1}
                    </span>
                    {coaches.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCoaches((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="size-4" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <Field label="Complete name">
                    <Input
                      value={c.fullName}
                      onChange={(e) =>
                        setCoaches((prev) =>
                          prev.map((row, idx) =>
                            idx === i ? { ...row, fullName: e.target.value } : row
                          )
                        )
                      }
                    />
                  </Field>
                  <GenderPicker
                    name={`coach-gender-${i}`}
                    value={c.gender}
                    onChange={(gender) =>
                      setCoaches((prev) =>
                        prev.map((row, idx) => (idx === i ? { ...row, gender } : row))
                      )
                    }
                  />
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

/** Wrapping the control associates it with the label without needing an id. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Label className="flex flex-col items-stretch gap-1.5 font-normal">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </Label>
  );
}

function GenderPicker({
  name,
  value,
  onChange,
}: {
  name: string;
  value: "M" | "F";
  onChange: (value: "M" | "F") => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-4">
      <Label className="text-xs text-muted-foreground">Gender</Label>
      <RadioGroup
        value={value}
        onValueChange={(v) => onChange(v as "M" | "F")}
        className="flex items-center gap-4"
      >
        <div className="flex items-center gap-2">
          <RadioGroupItem value="M" id={`${name}-m`} />
          <Label htmlFor={`${name}-m`} className="text-sm font-normal">
            Male
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="F" id={`${name}-f`} />
          <Label htmlFor={`${name}-f`} className="text-sm font-normal">
            Female
          </Label>
        </div>
      </RadioGroup>
    </div>
  );
}
