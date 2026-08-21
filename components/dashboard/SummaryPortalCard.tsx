"use client";

import { useId, useState } from "react";

// Type-only, so nothing from the server module reaches the client bundle.
import type { SchoolOption } from "@/app/admin/(shell)/dashboard-data";
import { ANY } from "@/components/admin/filter-select";
import { PortalCard } from "@/components/dashboard/PortalCard";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Like the Registration card, this one holds state because its button's href depends on
 * the select. Unlike that card the list is flat: 20-odd schools need no grouping, and
 * `ANY` means "no school yet", which routes to the picker rather than to a sheet for
 * nobody.
 */
export function SummaryPortalCard({ schools }: { schools: SchoolOption[] }) {
  const id = useId();
  const [schoolId, setSchoolId] = useState(ANY);

  return (
    <PortalCard
      title="Summary of Registration"
      description="One school's entries, the learners in each and the coaches behind them, on a single page."
      control={
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={id} className="text-xs text-muted-foreground">
            Quick access
          </Label>
          <Select value={schoolId} onValueChange={setSchoolId}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="All schools" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All schools</SelectItem>
              {schools.map((school) => (
                <SelectItem key={school.id} value={school.id}>
                  {school.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      actions={[
        {
          label: "Go to portal",
          href: schoolId === ANY ? "/admin/summary" : `/admin/summary?school=${schoolId}`,
        },
      ]}
    />
  );
}
