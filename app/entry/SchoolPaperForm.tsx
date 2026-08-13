"use client";

import { useState, useTransition } from "react";
import { saveSchoolPaperAction } from "./actions";

interface Staff {
  full_name: string;
  title: "section_head" | "assistant_head";
}

export interface ExistingPaper {
  id: string;
  language: "english" | "filipino";
  paper_name: string;
  adviser_name: string;
  adviser_gender: "M" | "F";
  principal_name: string;
  paper_staff: Staff[];
}

export function SchoolPaperForm({
  language,
  existing,
  locked,
}: {
  language: "english" | "filipino";
  existing: ExistingPaper | null;
  locked: boolean;
}) {
  const [paperName, setPaperName] = useState(existing?.paper_name ?? "");
  const [adviserName, setAdviserName] = useState(existing?.adviser_name ?? "");
  const [adviserGender, setAdviserGender] = useState<"M" | "F">(existing?.adviser_gender ?? "M");
  const [principalName, setPrincipalName] = useState(existing?.principal_name ?? "");
  const [staff, setStaff] = useState<{ fullName: string; title: "section_head" | "assistant_head" }[]>(
    existing?.paper_staff.length
      ? existing.paper_staff.map((s) => ({ fullName: s.full_name, title: s.title }))
      : [
          { fullName: "", title: "section_head" },
          { fullName: "", title: "section_head" },
        ]
  );
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateStaff(index: number, patch: Partial<{ fullName: string; title: "section_head" | "assistant_head" }>) {
    setStaff((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function addStaff() {
    setStaff((prev) => [...prev, { fullName: "", title: "section_head" }]);
  }

  function removeStaff(index: number) {
    setStaff((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveSchoolPaperAction({
        language,
        paperName,
        adviserName,
        adviserGender,
        principalName,
        staff,
      });
      if (result && "error" in result) {
        setMessage({ type: "error", text: result.error });
      } else {
        setMessage({ type: "success", text: "Saved." });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border p-4">
      <h3 className="font-semibold capitalize">{language}</h3>
      <label className="flex flex-col gap-1">
        <span className="text-sm">Name of School Paper</span>
        <input
          value={paperName}
          onChange={(e) => setPaperName(e.target.value)}
          disabled={locked}
          required
          className="rounded border px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">School Paper Adviser</span>
        <div className="flex gap-2">
          <input
            value={adviserName}
            onChange={(e) => setAdviserName(e.target.value)}
            disabled={locked}
            required
            className="flex-1 rounded border px-3 py-2"
          />
          <select
            value={adviserGender}
            onChange={(e) => setAdviserGender(e.target.value as "M" | "F")}
            disabled={locked}
            className="rounded border px-3 py-2"
          >
            <option value="M">M</option>
            <option value="F">F</option>
          </select>
        </div>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">School Principal</span>
        <input
          value={principalName}
          onChange={(e) => setPrincipalName(e.target.value)}
          disabled={locked}
          required
          className="rounded border px-3 py-2"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Section Heads / Assistant Heads (at least 2)</span>
        {staff.map((s, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={s.fullName}
              onChange={(e) => updateStaff(i, { fullName: e.target.value })}
              disabled={locked}
              required
              placeholder="Full name"
              className="flex-1 rounded border px-3 py-2"
            />
            <select
              value={s.title}
              onChange={(e) => updateStaff(i, { title: e.target.value as "section_head" | "assistant_head" })}
              disabled={locked}
              className="rounded border px-3 py-2"
            >
              <option value="section_head">Section Head</option>
              <option value="assistant_head">Assistant Head</option>
            </select>
            <button
              type="button"
              onClick={() => removeStaff(i)}
              disabled={locked || staff.length <= 2}
              className="text-sm text-red-600 disabled:opacity-30"
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addStaff} disabled={locked} className="self-start text-sm text-blue-600">
          + Add staff member
        </button>
      </div>

      {message && (
        <p className={message.type === "error" ? "text-sm text-red-600" : "text-sm text-green-600"}>
          {message.text}
        </p>
      )}

      <button
        type="submit"
        disabled={locked || isPending}
        className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
