"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
import { LANGUAGE_LABEL } from "@/lib/events-catalog";

interface Option {
  id: string;
  name: string;
}

const FILTER_KEYS = ["district", "school", "status", "lock", "language"] as const;

export function SchoolPaperFilterBar({
  districts,
  schools,
}: {
  districts: Option[];
  schools: Option[];
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
    router.push(qs ? `/admin/school-papers?${qs}` : "/admin/school-papers");
  }

  const activeCount = FILTER_KEYS.filter((k) => searchParams.get(k)).length;

  return (
    <Card>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
          label="Status"
          value={searchParams.get("status") ?? ANY}
          onChange={(v) => setParam("status", v)}
          placeholder="All statuses"
          options={[
            { value: "submitted", label: PAPER_STATUS_LABEL.submitted },
            { value: "saved", label: PAPER_STATUS_LABEL.saved },
            { value: "incomplete", label: PAPER_STATUS_LABEL.incomplete },
          ]}
        />
        <FilterSelect
          label="Submission lock"
          value={searchParams.get("lock") ?? ANY}
          onChange={(v) => setParam("lock", v)}
          placeholder="Locked + unlocked"
          options={[
            { value: "locked", label: "Locked" },
            { value: "unlocked", label: "Unlocked" },
          ]}
        />
        <FilterSelect
          label="Language on file"
          value={searchParams.get("language") ?? ANY}
          onChange={(v) => setParam("language", v)}
          placeholder={`${LANGUAGE_LABEL.english} + ${LANGUAGE_LABEL.filipino}`}
          options={[
            { value: "english", label: LANGUAGE_LABEL.english },
            { value: "filipino", label: LANGUAGE_LABEL.filipino },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-5">
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => router.push("/admin/school-papers")}>
              <X className="size-4" />
              Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
