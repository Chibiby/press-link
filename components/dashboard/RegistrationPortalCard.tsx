"use client";

import { useId, useState } from "react";

// Type-only, so nothing from the server module reaches the client bundle: `import type`
// is erased at compile time.
import type { EventOptionGroup } from "@/app/admin/(shell)/dashboard-data";
import { ANY } from "@/components/admin/filter-select";
import { PortalCard } from "@/components/dashboard/PortalCard";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The one portal card that needs state: both buttons' hrefs depend on what the select is
 * showing, so this is a client component while the other three stay server-rendered.
 *
 * It reuses `ANY` from the existing filter bar rather than inventing a second "no filter"
 * sentinel — Radix forbids an empty item value, and the two must agree.
 */
export function RegistrationPortalCard({ groups }: { groups: EventOptionGroup[] }) {
  const id = useId();
  const [eventId, setEventId] = useState(ANY);
  const query = eventId === ANY ? "" : `?event=${eventId}`;

  return (
    <PortalCard
      title="Registration"
      description="Every entry the division's schools have submitted, filterable by event."
      control={
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={id} className="text-xs text-muted-foreground">
            Quick access
          </Label>
          <Select value={eventId} onValueChange={setEventId}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All events</SelectItem>
              {groups.map((group) => (
                <SelectGroup key={group.typeId}>
                  <SelectLabel>{group.typeName}</SelectLabel>
                  {group.options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      actions={[
        { label: "Go to portal", href: `/admin/entries${query}` },
        // A plain anchor, not a Link: /admin/export is a route handler that builds a
        // spreadsheet, and Link would prefetch it on hover.
        { label: "Export", href: `/admin/export${query}`, external: true },
      ]}
    />
  );
}
