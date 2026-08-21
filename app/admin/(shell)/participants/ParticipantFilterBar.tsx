"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Asterisk, UserMinus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ANY, FilterSelect } from "@/components/admin/filter-select";

interface Option {
  id: string;
  name: string;
}

/**
 * Every key that narrows the table, and the list the Clear button counts.
 *
 * `unassigned` is in here because the dashboard's "Learners with no entry" row links
 * straight to `?unassigned=1`. Leaving it out meant arriving from that link with no
 * other filter set gave `activeCount === 0`, so Clear never rendered — a reader saw a
 * heavily filtered table with nothing on screen saying it was filtered and no route
 * back. `/admin/coaches` has always had this right; this is the same list.
 */
const FILTER_KEYS = ["district", "school", "multi", "unassigned"] as const;

export function ParticipantFilterBar({
  districts,
  schools,
}: {
  districts: Option[];
  schools: Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string | null, clearKey?: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ANY) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // The two toggles are mutually exclusive — "in more than one event" and "in no
    // event" cannot both hold — so switching one on clears the other in the same
    // navigation rather than leaving a stale, contradictory param in the URL.
    if (clearKey) params.delete(clearKey);
    const qs = params.toString();
    router.push(qs ? `/admin/participants?${qs}` : "/admin/participants");
  }

  const multiOnly = searchParams.get("multi") === "1";
  const unassignedOnly = searchParams.get("unassigned") === "1";
  const activeCount = FILTER_KEYS.filter((k) => searchParams.get(k)).length;

  return (
    <Card>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FilterSelect
          label="District"
          value={searchParams.get("district") ?? ANY}
          onChange={(v) => setParam("district", v)}
          placeholder="All districts"
          options={districts.map((d) => ({ value: d.id, label: d.name }))}
        />
        <FilterSelect
          label="School"
          value={searchParams.get("school") ?? ANY}
          onChange={(v) => setParam("school", v)}
          placeholder="All schools"
          options={schools.map((s) => ({ value: s.id, label: s.name }))}
        />

        <div className="flex flex-wrap items-end gap-2">
          <Button
            type="button"
            variant={multiOnly ? "default" : "outline"}
            aria-pressed={multiOnly}
            onClick={() => setParam("multi", multiOnly ? null : "1", "unassigned")}
          >
            <Asterisk className="size-4" />
            Multi-event only
          </Button>
          <Button
            type="button"
            variant={unassignedOnly ? "default" : "outline"}
            aria-pressed={unassignedOnly}
            onClick={() => setParam("unassigned", unassignedOnly ? null : "1", "multi")}
          >
            <UserMinus className="size-4" />
            Unassigned only
          </Button>
          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/admin/participants")}
            >
              <X className="size-4" />
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
