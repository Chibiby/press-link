"use client";

import { Download, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function OverallDataFilter({
  districts,
}: {
  districts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const district = searchParams.get("district");

  function setDistrict(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ANY) {
      params.set("district", value);
    } else {
      params.delete("district");
    }
    const qs = params.toString();
    router.push(qs ? `/admin/overall-data?${qs}` : "/admin/overall-data");
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <FilterSelect
            label="District"
            value={district ?? ANY}
            onChange={setDistrict}
            placeholder="All districts"
            options={districts.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>

        {district ? (
          <Button variant="ghost" size="sm" onClick={() => setDistrict(ANY)}>
            <X className="size-4" />
            Clear filter
          </Button>
        ) : null}

        <Button asChild variant="outline" size="sm" className="ml-auto">
          {/* A route handler, and it carries the filter, so the file matches the screen.
              A plain anchor: next/link would build a workbook on hover. */}
          <a href={`/admin/overall-data/export?${searchParams.toString()}`}>
            <Download className="size-4" />
            Export to Excel
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
