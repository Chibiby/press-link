"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Plus, Trash2 } from "lucide-react";

import { saveSchoolPaperAction } from "./actions";
import type { SchoolPaperRow } from "./types";
import { schoolPaperSchema } from "@/lib/validation/school-paper";
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

const emptyStaff = (): StaffDraft => ({ fullName: "", title: "section_head" });

function toDraft(paper: SchoolPaperRow | null): PaperDraft {
  if (!paper) {
    return {
      paperName: "",
      adviserName: "",
      adviserGender: "M",
      principalName: "",
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  papers: SchoolPaperRow[];
  locked: boolean;
  /**
   * The school still owes these papers. Saving them is the only way out: no
   * close button, and neither Escape nor the overlay dismisses it. A school
   * that opened the form itself keeps its close button.
   */
  required?: boolean;
}) {
  const english = papers.find((p) => p.language === "english") ?? null;
  const filipino = papers.find((p) => p.language === "filipino") ?? null;

  return (
    <Dialog open={open} onOpenChange={required ? () => {} : onOpenChange}>
      <DialogContent
        showCloseButton={!required}
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>School Paper</DialogTitle>
          <DialogDescription>
            {locked
              ? "Submitted as your school paper entry. Contact the division office if this needs a change."
              : required
                ? "Save both the English and Filipino paper to continue."
                : "Filled once per language and reused across every entry. Save each language separately."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="english">
          <TabsList className="w-full">
            <TabsTrigger value="english" className="flex-1 gap-2">
              English
              <CompletionDot complete={Boolean(english)} />
            </TabsTrigger>
            <TabsTrigger value="filipino" className="flex-1 gap-2">
              Filipino
              <CompletionDot complete={Boolean(filipino)} />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="english" className="pt-4">
            <PaperForm
              language="english"
              existing={english}
              locked={locked}
            />
          </TabsContent>
          <TabsContent value="filipino" className="pt-4">
            <PaperForm
              language="filipino"
              existing={filipino}
              locked={locked}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
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
  existing,
  locked,
}: {
  language: EventLanguage;
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

  function patch(patchObj: Partial<PaperDraft>) {
    setDraft((prev) => ({ ...prev, ...patchObj }));
  }

  function handleSave() {
    setError(null);
    const input = { language, ...draft };
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
      toast.success(`${language === "english" ? "English" : "Filipino"} paper saved.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${language}-paper-name`}>Name of School Paper</Label>
        <Input
          id={`${language}-paper-name`}
          value={draft.paperName}
          disabled={locked}
          onChange={(e) => patch({ paperName: e.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${language}-adviser-name`}>School Paper Adviser</Label>
          <Input
            id={`${language}-adviser-name`}
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
              <RadioGroupItem value="M" id={`${language}-adviser-m`} />
              <Label htmlFor={`${language}-adviser-m`} className="text-sm font-normal">
                Male
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="F" id={`${language}-adviser-f`} />
              <Label htmlFor={`${language}-adviser-f`} className="text-sm font-normal">
                Female
              </Label>
            </div>
          </RadioGroup>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${language}-principal-name`}>School Principal</Label>
        <Input
          id={`${language}-principal-name`}
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
            Save {language === "english" ? "English" : "Filipino"} paper
          </>
        )}
      </Button>
    </div>
  );
}
