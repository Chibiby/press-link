"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";

import { createSchoolAccountAction } from "./actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Creates a school row and its login together, in one server action. Kept
 * separate from `AccountRowActions.tsx`: those two buttons act on an
 * existing row, this one adds a new one, and the page renders this as the
 * `PageHeading` action rather than in the table.
 */
export function AddSchoolDialog({
  districts,
}: {
  districts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const nameId = useId();
  const districtId = useId();
  const numberId = useId();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [district, setDistrict] = useState("");
  const [schoolIdNumber, setSchoolIdNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function show(next: boolean) {
    setOpen(next);
    if (!next) {
      // A failure from the last attempt must not be the first thing the next
      // open shows, and a school added successfully must not still be sitting
      // in the form if the dialog is reopened before the refresh lands.
      setName("");
      setDistrict("");
      setSchoolIdNumber("");
      setError(null);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createSchoolAccountAction({
        name: name.trim(),
        districtId: district,
        schoolIdNumber: schoolIdNumber.trim(),
      });

      if ("error" in result) {
        // Inline and persistent, not a toast: the dialog stays open so the
        // reader can fix the field the server rejected without retyping
        // everything else. A partial failure can still have created the
        // school row (see actions.ts), so the table underneath needs the
        // same refresh the success path gets — the admin just doesn't see
        // it until they close this dialog or look past it.
        setError(result.error);
        router.refresh();
        return;
      }

      toast.success(`${name.trim()} was added, with a login.`);
      show(false);
      router.refresh();
    });
  }

  // Client-side, this only blocks an obviously-empty submission. The server
  // action is the source of truth for the rest — the digits-only rule on the
  // ID number included.
  const canSubmit = name.trim() !== "" && district !== "" && schoolIdNumber.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={show}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add school
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a school</DialogTitle>
          <DialogDescription>
            Creates the school and its login together.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>School name</Label>
            <Input
              id={nameId}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Alabel National High School"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={districtId}>District</Label>
            <Select value={district} onValueChange={setDistrict}>
              <SelectTrigger id={districtId} className="w-full">
                <SelectValue placeholder="Choose a district" />
              </SelectTrigger>
              <SelectContent>
                {districts.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={numberId}>School ID number</Label>
            <Input
              id={numberId}
              value={schoolIdNumber}
              onChange={(event) => setSchoolIdNumber(event.target.value)}
              placeholder="Digits only, e.g. 300123"
              inputMode="numeric"
              autoComplete="off"
            />
          </div>

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
              {isPending ? "Adding…" : "Add school"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
