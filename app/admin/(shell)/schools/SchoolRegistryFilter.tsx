"use client";

import { X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { ANY, FilterSelect } from "@/components/admin/filter-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SCHOOL_STATUS_LABEL, type SchoolStatus } from "@/lib/dashboard/school-registry";

/** "all" is the placeholder, so it is not offered again as an item. */
const STATUS_OPTIONS: SchoolStatus[] = [
  "learners-no-entry",
  "no-data",
  "entered",
  "locked",
  "integrated",
];

export function SchoolRegistryFilter({
  districts,
}: {
  districts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const district = searchParams.get("district");
  const status = searchParams.get("status");

  function replace(key: "district" | "status", value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== ANY) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `/admin/schools?${qs}` : "/admin/schools");
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3">
        <div className="min-w-56">
          <FilterSelect
            label="District"
            value={district ?? ANY}
            onChange={(value) => replace("district", value)}
            placeholder="All districts"
            options={districts.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>

        <div className="min-w-56">
          <FilterSelect
            label="Status"
            value={status ?? ANY}
            onChange={(value) => replace("status", value)}
            placeholder={SCHOOL_STATUS_LABEL.all}
            options={STATUS_OPTIONS.map((value) => ({
              value,
              label: SCHOOL_STATUS_LABEL[value],
            }))}
          />
        </div>

        {district || status ? (
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin/schools")}>
            <X className="size-4" />
            Clear filters
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
