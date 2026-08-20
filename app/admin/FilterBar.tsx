"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ANY, FilterSelect } from "@/components/admin/filter-select";

interface Option {
  id: string;
  name: string;
}

const FILTER_KEYS = ["district", "school", "event", "category", "level", "language"] as const;

export function FilterBar({
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

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ANY) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/entries?${qs}` : "/admin/entries");
  }

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
          placeholder="English + Filipino"
          options={[
            { value: "english", label: "English" },
            { value: "filipino", label: "Filipino" },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6">
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => router.push("/admin/entries")}>
              <X className="size-4" />
              Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="ml-auto">
            {/* Carries the current filters so the file matches the screen. */}
            <a href={`/admin/export?${searchParams.toString()}`}>
              <Download className="size-4" />
              Export to Excel
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
