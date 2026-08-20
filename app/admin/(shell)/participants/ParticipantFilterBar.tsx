"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Asterisk, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ANY, FilterSelect } from "@/components/admin/filter-select";

interface Option {
  id: string;
  name: string;
}

export function ParticipantFilterBar({
  districts,
  schools,
}: {
  districts: Option[];
  schools: Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ANY) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/participants?${qs}` : "/admin/participants");
  }

  const multiOnly = searchParams.get("multi") === "1";
  const activeCount = ["district", "school", "multi"].filter((k) => searchParams.get(k)).length;

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

        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant={multiOnly ? "default" : "outline"}
            aria-pressed={multiOnly}
            onClick={() => setParam("multi", multiOnly ? null : "1")}
          >
            <Asterisk className="size-4" />
            Multi-event only
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
