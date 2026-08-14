"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, ChevronsUpDown, Loader2, School as SchoolIcon } from "lucide-react";

import { loginAction } from "./actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { PasswordInput } from "@/components/password-input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface District {
  id: string;
  name: string;
}

interface School {
  id: string;
  name: string;
  district_id: string;
}

export function LoginForm({ districts, schools }: { districts: District[]; schools: School[] }) {
  const [districtId, setDistrictId] = useState("ALL");
  const [schoolId, setSchoolId] = useState("");
  const [schoolOpen, setSchoolOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredSchools = useMemo(
    () => (districtId === "ALL" ? schools : schools.filter((s) => s.district_id === districtId)),
    [districtId, schools]
  );

  const selectedSchool = schools.find((s) => s.id === schoolId);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await loginAction(formData);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-5">
      {/* Radix Select and the school combobox are not native form controls, so
          their values ride along as hidden inputs. */}
      <input type="hidden" name="districtId" value={districtId} />
      <input type="hidden" name="schoolId" value={schoolId} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="district-trigger">District</Label>
        <Select
          value={districtId}
          onValueChange={(value) => {
            setDistrictId(value);
            setSchoolId("");
          }}
        >
          <SelectTrigger id="district-trigger" className="w-full">
            <SelectValue placeholder="All districts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All districts</SelectItem>
            {districts.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="school-trigger">School</Label>
        <Popover open={schoolOpen} onOpenChange={setSchoolOpen}>
          <PopoverTrigger asChild>
            <Button
              id="school-trigger"
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={schoolOpen}
              className="w-full justify-between font-normal"
            >
              <span className={cn("truncate", !selectedSchool && "text-muted-foreground")}>
                {selectedSchool ? selectedSchool.name : "Select your school"}
              </span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-(--radix-popover-trigger-width) p-0"
            align="start"
          >
            <Command>
              <CommandInput placeholder="Search schools..." />
              <CommandList>
                <CommandEmpty>No school found.</CommandEmpty>
                <CommandGroup>
                  {filteredSchools.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={s.name}
                      onSelect={() => {
                        setSchoolId(s.id);
                        setSchoolOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          s.id === schoolId ? "opacity-100" : "opacity-0"
                        )}
                      />
                      <span className="truncate">{s.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <p className="text-xs text-muted-foreground">
          {filteredSchools.length} school{filteredSchools.length === 1 ? "" : "s"} available
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">School ID</Label>
        <PasswordInput id="password" name="password" required autoComplete="off" />
        <p className="text-xs text-muted-foreground">
          Your school&apos;s DepEd School ID number is your password.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={isPending || !schoolId} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in...
          </>
        ) : (
          <>
            <SchoolIcon className="size-4" />
            Sign in
          </>
        )}
      </Button>
    </form>
  );
}
