"use client";

import { useMemo, useState, useTransition } from "react";
import { loginAction } from "./actions";

interface District {
  id: string;
  name: string;
}

interface School {
  id: string;
  name: string;
  district_id: string;
}

export function LoginForm({ districts, schools }: { districts: District[]; schools: School[] }) {
  const [districtId, setDistrictId] = useState("ALL");
  const [schoolId, setSchoolId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredSchools = useMemo(
    () => (districtId === "ALL" ? schools : schools.filter((s) => s.district_id === districtId)),
    [districtId, schools]
  );

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await loginAction(formData);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">District</span>
        <select
          name="districtId"
          value={districtId}
          onChange={(e) => {
            setDistrictId(e.target.value);
            setSchoolId("");
          }}
          className="rounded border px-3 py-2"
        >
          <option value="ALL">ALL</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">School</span>
        <select
          name="schoolId"
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
          className="rounded border px-3 py-2"
          required
        >
          <option value="" disabled>
            Select your school
          </option>
          {filteredSchools.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">School ID (password)</span>
        <input type="password" name="password" className="rounded border px-3 py-2" required />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
