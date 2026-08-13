"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface Option {
  id: string;
  name: string;
}

export function FilterBar({ districts, schools, events }: { districts: Option[]; schools: Option[]; events: Option[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/admin?${params.toString()}`);
  }

  return (
    <div className="mb-6 flex flex-wrap gap-3">
      <select
        defaultValue={searchParams.get("district") ?? ""}
        onChange={(e) => setParam("district", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">All districts</option>
        {districts.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <select
        defaultValue={searchParams.get("school") ?? ""}
        onChange={(e) => setParam("school", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">All schools</option>
        {schools.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        defaultValue={searchParams.get("event") ?? ""}
        onChange={(e) => setParam("event", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">All events</option>
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>
            {ev.name}
          </option>
        ))}
      </select>

      <select
        defaultValue={searchParams.get("category") ?? ""}
        onChange={(e) => setParam("category", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">Individual + Group</option>
        <option value="individual">Individual</option>
        <option value="group">Group</option>
      </select>

      <select
        defaultValue={searchParams.get("language") ?? ""}
        onChange={(e) => setParam("language", e.target.value)}
        className="rounded border px-3 py-2 text-sm"
      >
        <option value="">English + Filipino</option>
        <option value="english">English</option>
        <option value="filipino">Filipino</option>
      </select>
    </div>
  );
}
