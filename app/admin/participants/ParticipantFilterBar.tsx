"use client";

import { useId } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Asterisk, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Option {
  id: string;
  name: string;
}

/** Radix Select forbids an empty item value, so "any" stands in for "no filter". */
const ANY = "__any__";

export function ParticipantFilterBar({
  districts,
  schools,
}: {
  districts: Option[];
  schools: Option[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const districtId = useId();
  const schoolId = useId();

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
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={districtId} className="text-xs text-muted-foreground">
            District
          </Label>
          <Select
            value={searchParams.get("district") ?? ANY}
            onValueChange={(v) => setParam("district", v)}
          >
            <SelectTrigger id={districtId} className="w-full">
              <SelectValue placeholder="All districts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All districts</SelectItem>
              {districts.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={schoolId} className="text-xs text-muted-foreground">
            School
          </Label>
          <Select
            value={searchParams.get("school") ?? ANY}
            onValueChange={(v) => setParam("school", v)}
          >
            <SelectTrigger id={schoolId} className="w-full">
              <SelectValue placeholder="All schools" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All schools</SelectItem>
              {schools.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
