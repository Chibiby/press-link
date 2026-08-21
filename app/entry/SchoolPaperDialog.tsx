"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";

import { saveSchoolPaperAction } from "./actions";
import type { ArchivedPaperRow, SchoolPaperRow } from "./types";
import { schoolPaperSchema } from "@/lib/validation/school-paper";
import {
  INTEGRATED_LEVELS,
  PAPER_LEVEL_LABEL,
  paperSlots,
  type PaperLevel,
  type PaperSlot,
} from "@/lib/paper/level";
import type { EventLanguage } from "@/lib/events-catalog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface StaffDraft {
  fullName: string;
  title: "section_head" | "assistant_head";
}

interface PaperDraft {
  paperName: string;
  adviserName: string;
  adviserGender: "M" | "F";
  principalName: string;
  staff: StaffDraft[];
}

/**
 * Nothing here is compulsory any more — a school may publish in one language,
 * or have no paper at all — so every field arrives already answered with N/A
 * and the school overwrites what applies to it.
 */
const NOT_APPLICABLE = "N/A";

const LANGUAGE_LABEL: Record<EventLanguage, string> = {
  english: "English",
  filipino: "Filipino",
};

/** What one form saves, spelled the way the school reads it: "English elementary paper". */
function paperLabel(language: EventLanguage, level: PaperLevel): string {
  return level === "whole"
    ? `${LANGUAGE_LABEL[language]} paper`
    : `${LANGUAGE_LABEL[language]} ${PAPER_LEVEL_LABEL[level].toLowerCase()} paper`;
}

const emptyStaff = (): StaffDraft => ({
  fullName: NOT_APPLICABLE,
  title: "section_head",
});

function toDraft(paper: SchoolPaperRow | null): PaperDraft {
  if (!paper) {
    return {
      paperName: NOT_APPLICABLE,
      adviserName: NOT_APPLICABLE,
      adviserGender: "M",
      principalName: NOT_APPLICABLE,
      staff: [emptyStaff(), emptyStaff()],
    };
  }
  return {
    paperName: paper.paper_name,
    adviserName: paper.adviser_name,
    adviserGender: paper.adviser_gender,
    principalName: paper.principal_name,
    staff:
      paper.paper_staff.length >= 2
        ? paper.paper_staff.map((s) => ({ fullName: s.full_name, title: s.title }))
        : [emptyStaff(), emptyStaff()],
  };
}

export function SchoolPaperDialog({
  open,
  onOpenChange,
  papers,
  locked,
  required,
  isIntegrated,
  archivedPapers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  papers: SchoolPaperRow[];
  /** True once the school's whole submission is locked — paper, roster and entries. */
  locked: boolean;
  /**
   * Stage 1 is unfinished: not one language is on file. Saving one is the only
   * way out, so there is no close button and neither Escape nor the overlay
   * dismisses it. A school that opened the form itself keeps its close button.
   */
  required?: boolean;
  /**
   * An integrated school runs elementary and secondary under one id and files a
   * separate paper for each, per language — four forms instead of two. Comes
   * from the `schools.is_integrated` column, never re-derived from the name.
   */
  isIntegrated: boolean;
  archivedPapers: ArchivedPaperRow[];
}) {
  // One source for what this school owes and what is on file, so the tab
  // badges, the outstanding line and the forms cannot disagree. A saved row
  // whose level contradicts its school fills nothing — see lib/paper/level.ts.
  const slots = paperSlots(isIntegrated, papers);
  const outstanding = slots.filter((slot) => !slot.filled);

  const languageComplete = (language: EventLanguage) =>
    slots.every((slot) => slot.language !== language || slot.filled);

  // Lifted out of the JSX because there are now six wordings, not three: an
  // integrated school is told it owes two papers per language, and every other
  // school is told exactly what it was told before.
  const description = locked
    ? "These details are locked. Contact the division office if they need a change."
    : isIntegrated
      ? required
        ? "Your school files a separate elementary and secondary paper. Save one of each — either language — to continue."
        : "Your school files a separate elementary and secondary paper for each language. Anything that does not apply can stay N/A."
      : required
        ? "Fill in your school paper — English, Filipino, or both. Save at least one to continue."
        : "Fill in whichever languages your school publishes in. Anything that does not apply can stay N/A.";

  return (
    <Dialog open={open} onOpenChange={required ? () => {} : onOpenChange}>
      <DialogContent
        showCloseButton={!required}
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>School Paper</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {/* Stated as a fact, not as a demand. `paperFlowState` clears the gate on one
            language, so an integrated school that has filed both English papers owes
            nothing further — "still to file" would tell it otherwise. This lists what
            is blank so the school can see it, and says no more than that. */}
        {isIntegrated && !locked && outstanding.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Not yet filled in:{" "}
            {outstanding.map((slot) => paperLabel(slot.language, slot.level)).join(", ")}.
          </p>
        )}

        {archivedPapers.length > 0 && (
          /* The school filed these before it was known to be integrated. They were
             retired rather than deleted, and are shown here so nobody has to
             reconstruct an adviser and a set of section heads from memory. */
          <div className="rounded-md border border-dashed p-3 text-sm">
            <p className="font-medium">Your earlier school paper needs re-filing</p>
            <p className="mt-1 text-muted-foreground">
              Your school files a separate elementary and secondary paper, so what you
              submitted before could not be split between them. It is kept here for
              reference — copy from it as you fill in the forms below.
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              {archivedPapers.map((paper) => (
                <li key={paper.id}>
                  <span className="font-medium text-foreground">
                    {LANGUAGE_LABEL[paper.language]}
                  </span>{" "}
                  — {paper.paper_name}, adviser {paper.adviser_name}, principal{" "}
                  {paper.principal_name}
                  {paper.staff.length > 0 && (
                    <> · {paper.staff.map((member) => member.full_name).join(", ")}</>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Tabs defaultValue="english">
          <TabsList className="w-full">
            <TabsTrigger value="english" className="flex-1 gap-2">
              English
              <CompletionDot complete={languageComplete("english")} />
            </TabsTrigger>
            <TabsTrigger value="filipino" className="flex-1 gap-2">
              Filipino
              <CompletionDot complete={languageComplete("filipino")} />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="english" className="pt-4">
            <LanguagePanel
              language="english"
              papers={papers}
              locked={locked}
              isIntegrated={isIntegrated}
              slots={slots}
            />
          </TabsContent>
          <TabsContent value="filipino" className="pt-4">
            <LanguagePanel
              language="filipino"
              papers={papers}
              locked={locked}
              isIntegrated={isIntegrated}
              slots={slots}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One language's worth of the form.
 *
 * A non-integrated school gets exactly what it has always got: a single form,
 * no second row of tabs, no level anywhere in the markup. An integrated school
 * gets its elementary and secondary papers as two tabs under this language,
 * because they carry different names, advisers and section heads and cannot
 * share one form.
 */
function LanguagePanel({
  language,
  papers,
  locked,
  isIntegrated,
  slots,
}: {
  language: EventLanguage;
  papers: SchoolPaperRow[];
  locked: boolean;
  isIntegrated: boolean;
  slots: PaperSlot[];
}) {
  // Matched on level as well as language, so a row left behind by a
  // reclassified school never loads into a form that cannot save it back.
  const saved = (level: PaperLevel) =>
    papers.find((paper) => paper.language === language && paper.level === level) ?? null;

  if (!isIntegrated) {
    return (
      <PaperForm language={language} level="whole" existing={saved("whole")} locked={locked} />
    );
  }

  const filled = (level: PaperLevel) =>
    slots.some((slot) => slot.language === language && slot.level === level && slot.filled);

  return (
    <Tabs defaultValue={INTEGRATED_LEVELS[0]}>
      <TabsList className="w-full">
        {INTEGRATED_LEVELS.map((level) => (
          <TabsTrigger key={level} value={level} className="flex-1 gap-2">
            {PAPER_LEVEL_LABEL[level]}
            <CompletionDot complete={filled(level)} />
          </TabsTrigger>
        ))}
      </TabsList>
      {INTEGRATED_LEVELS.map((level) => (
        <TabsContent key={level} value={level} className="pt-4">
          <PaperForm
            language={language}
            level={level}
            existing={saved(level)}
            locked={locked}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function CompletionDot({ complete }: { complete: boolean }) {
  return (
    <Badge variant={complete ? "secondary" : "outline"} className="text-[10px]">
      {complete ? "Complete" : "Incomplete"}
    </Badge>
  );
}

function PaperForm({
  language,
  level,
  existing,
  locked,
}: {
  language: EventLanguage;
  level: PaperLevel;
  existing: SchoolPaperRow | null;
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<PaperDraft>(() => toDraft(existing));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(toDraft(existing));
  }, [existing]);

  // A non-integrated school has one form per language, so its field ids stay
  // exactly what they were before levels existed. Only the two forms an
  // integrated school shows under one language need the level to tell them
  // apart, and a duplicate id would point both labels at the first field.
  const fieldId = level === "whole" ? language : `${language}-${level}`;
  const label = paperLabel(language, level);

  function patch(patchObj: Partial<PaperDraft>) {
    setDraft((prev) => ({ ...prev, ...patchObj }));
  }

  function handleSave() {
    setError(null);
    const input = { language, level, ...draft };
    const parsed = schoolPaperSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    startTransition(async () => {
      const result = await saveSchoolPaperAction(input);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      toast.success(`${label.charAt(0).toUpperCase()}${label.slice(1)} saved.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-paper-name`}>Name of School Paper</Label>
        <Input
          id={`${fieldId}-paper-name`}
          value={draft.paperName}
          disabled={locked}
          onChange={(e) => patch({ paperName: e.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${fieldId}-adviser-name`}>School Paper Adviser</Label>
          <Input
            id={`${fieldId}-adviser-name`}
            value={draft.adviserName}
            disabled={locked}
            onChange={(e) => patch({ adviserName: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Adviser gender</Label>
          <RadioGroup
            value={draft.adviserGender}
            disabled={locked}
            onValueChange={(v) => patch({ adviserGender: v as "M" | "F" })}
            className="flex h-8 items-center gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="M" id={`${fieldId}-adviser-m`} />
              <Label htmlFor={`${fieldId}-adviser-m`} className="text-sm font-normal">
                Male
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="F" id={`${fieldId}-adviser-f`} />
              <Label htmlFor={`${fieldId}-adviser-f`} className="text-sm font-normal">
                Female
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-principal-name`}>School Principal</Label>
        <Input
          id={`${fieldId}-principal-name`}
          value={draft.principalName}
          disabled={locked}
          onChange={(e) => patch({ principalName: e.target.value })}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <Label>
            Section / Assistant Heads{" "}
            <span className="font-normal text-muted-foreground">(at least 2)</span>
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={locked}
            onClick={() => patch({ staff: [...draft.staff, emptyStaff()] })}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>

        {draft.staff.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              placeholder="Complete name"
              value={s.fullName}
              disabled={locked}
              onChange={(e) =>
                patch({
                  staff: draft.staff.map((row, idx) =>
                    idx === i ? { ...row, fullName: e.target.value } : row
                  ),
                })
              }
            />
            <Select
              value={s.title}
              disabled={locked}
              onValueChange={(v) =>
                patch({
                  staff: draft.staff.map((row, idx) =>
                    idx === i ? { ...row, title: v as StaffDraft["title"] } : row
                  ),
                })
              }
            >
              <SelectTrigger className="w-44 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="section_head">Section Head</SelectItem>
                <SelectItem value="assistant_head">Assistant Head</SelectItem>
              </SelectContent>
            </Select>
            {draft.staff.length > 2 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={locked}
                aria-label={`Remove head ${i + 1}`}
                onClick={() =>
                  patch({ staff: draft.staff.filter((_, idx) => idx !== i) })
                }
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="button" onClick={handleSave} disabled={isPending || locked}>
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Saving...
          </>
        ) : (
          <>
            <Check className="size-4" />
            Save {label}
          </>
        )}
      </Button>
    </div>
  );
}
