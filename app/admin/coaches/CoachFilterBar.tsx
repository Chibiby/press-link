"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Asterisk, UserMinus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { LANGUAGE_LABEL } from "@/lib/events-catalog";

interface Option {
  id: string;
  name: string;
}

const FILTER_KEYS = [
  "district",
  "school",
  "gender",
  "multi",
  "unassigned",
  "event",
  "category",
  "level",
  "language",
] as const;

export function CoachFilterBar({
  districts,
  schools,
  events,
}: {
  districts: Option[];
  schools: Option[];
  events: Option[];
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
    // The two toggles are mutually exclusive, so switching one on clears the
    // other in the same navigation rather than leaving a stale, contradictory param.
    if (clearKey) params.delete(clearKey);
    const qs = params.toString();
    router.push(qs ? `/admin/coaches?${qs}` : "/admin/coaches");
  }

  const multiOnly = searchParams.get("multi") === "1";
  const unassignedOnly = searchParams.get("unassigned") === "1";
  const activeCount = FILTER_KEYS.filter((k) => searchParams.get(k)).length;

  return (
    <Card>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
        <FilterSelect
          label="Gender"
          value={searchParams.get("gender") ?? ANY}
          onChange={(v) => setParam("gender", v)}
          placeholder="Male + Female"
          options={[
            { value: "M", label: "Male" },
            { value: "F", label: "Female" },
          ]}
        />
        <FilterSelect
          label="Event"
          value={searchParams.get("event") ?? ANY}
          onChange={(v) => setParam("event", v)}
          placeholder="All events"
          options={events.map((e) => ({ value: e.id, label: e.name }))}
        />
        <FilterSelect
          label="Category"
          value={searchParams.get("category") ?? ANY}
          onChange={(v) => setParam("category", v)}
          placeholder="Individual + Group"
          options={[
            { value: "individual", label: "Individual" },
            { value: "group", label: "Group" },
          ]}
        />
        <FilterSelect
          label="Level"
          value={searchParams.get("level") ?? ANY}
          onChange={(v) => setParam("level", v)}
          placeholder="Elem + Secondary"
          options={[
            { value: "elementary", label: "Elementary" },
            { value: "secondary", label: "Secondary" },
          ]}
        />
        <FilterSelect
          label="Language"
          value={searchParams.get("language") ?? ANY}
          onChange={(v) => setParam("language", v)}
          placeholder={`${LANGUAGE_LABEL.english} + ${LANGUAGE_LABEL.filipino}`}
          options={[
            { value: "english", label: LANGUAGE_LABEL.english },
            { value: "filipino", label: LANGUAGE_LABEL.filipino },
          ]}
        />

        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6">
          <Button
            type="button"
            variant={multiOnly ? "default" : "outline"}
            aria-pressed={multiOnly}
            onClick={() => setParam("multi", multiOnly ? null : "1", "unassigned")}
          >
            <Asterisk className="size-4" />
            Multi-entry only
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
            <Button variant="ghost" size="sm" onClick={() => router.push("/admin/coaches")}>
              <X className="size-4" />
              Clear
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
