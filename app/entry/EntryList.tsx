"use client";

import { useMemo, useState, useTransition } from "react";
import { deleteEntryAction, saveEntryAction } from "./actions";

interface EventOption {
  id: string;
  category: "individual" | "group";
  level: "elementary" | "secondary";
  language: "english" | "filipino";
  name: string;
}

interface Participant {
  first_name: string;
  middle_name: string | null;
  last_name: string;
  gender: "M" | "F";
}

interface Coach {
  full_name: string;
  gender: "M" | "F";
}

export interface Entry {
  id: string;
  submitted_at: string;
  events: { name: string } | null;
  entry_participants: Participant[];
  entry_coaches: Coach[];
}

type DraftParticipant = { firstName: string; middleName: string; lastName: string; gender: "M" | "F" };
type DraftCoach = { fullName: string; gender: "M" | "F" };

function emptyParticipant(): DraftParticipant {
  return { firstName: "", middleName: "", lastName: "", gender: "M" };
}

function emptyCoach(): DraftCoach {
  return { fullName: "", gender: "M" };
}

export function EntryList({
  entries,
  events,
  locked,
}: {
  entries: Entry[];
  events: EventOption[];
  locked: boolean;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [eventId, setEventId] = useState("");
  const [participants, setParticipants] = useState<DraftParticipant[]>([emptyParticipant()]);
  const [coaches, setCoaches] = useState<DraftCoach[]>([emptyCoach()]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const groupedEvents = useMemo(() => {
    const groups: Record<string, EventOption[]> = {};
    for (const ev of events) {
      const key = `${ev.category} / ${ev.level} / ${ev.language}`;
      (groups[key] ??= []).push(ev);
    }
    return groups;
  }, [events]);

  const selectedEvent = events.find((e) => e.id === eventId);
  const isGroup = selectedEvent?.category === "group";

  function startNew() {
    setEditingId("new");
    setEventId("");
    setParticipants([emptyParticipant()]);
    setCoaches([emptyCoach()]);
    setError(null);
  }

  function cancel() {
    setEditingId(null);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const category = selectedEvent?.category ?? "individual";
    startTransition(async () => {
      const result = await saveEntryAction(editingId === "new" ? null : editingId, {
        eventId,
        category,
        participants,
        coaches,
      });
      if (result && "error" in result) {
        setError(result.error);
      } else {
        setEditingId(null);
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteEntryAction(id);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Event</th>
            <th className="py-2">Participant(s)</th>
            <th className="py-2">Coach(es)</th>
            <th className="py-2">Submitted</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b">
              <td className="py-2">{entry.events?.name}</td>
              <td className="py-2">
                {entry.entry_participants.map((p) => `${p.first_name} ${p.last_name}`).join(", ")}
              </td>
              <td className="py-2">{entry.entry_coaches.map((c) => c.full_name).join(", ")}</td>
              <td className="py-2">{new Date(entry.submitted_at).toLocaleString()}</td>
              <td className="py-2 text-right">
                <button onClick={() => handleDelete(entry.id)} disabled={locked} className="text-red-600 disabled:opacity-30">
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-gray-500">
                No entries yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!locked && editingId === null && (
        <button onClick={startNew} className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">
          + Add Entry
        </button>
      )}

      {editingId !== null && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded border p-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Event</span>
            <select
              value={eventId}
              onChange={(e) => {
                const nextEventId = e.target.value;
                setEventId(nextEventId);
                const nextEvent = events.find((ev) => ev.id === nextEventId);
                if (nextEvent?.category === "group") {
                  setParticipants((prev) => (prev.length >= 2 ? prev : [...prev, emptyParticipant()]));
                } else {
                  setParticipants((prev) => prev.slice(0, 1));
                }
              }}
              required
              className="rounded border px-3 py-2"
            >
              <option value="" disabled>
                Select an event
              </option>
              {Object.entries(groupedEvents).map(([group, evs]) => (
                <optgroup key={group} label={group}>
                  {evs.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{isGroup ? "Participants (at least 2)" : "Participant"}</span>
            {participants.map((p, i) => (
              <div key={i} className="flex flex-wrap gap-2">
                <input
                  value={p.firstName}
                  onChange={(e) =>
                    setParticipants((prev) => prev.map((x, idx) => (idx === i ? { ...x, firstName: e.target.value } : x)))
                  }
                  placeholder="First name"
                  required
                  className="flex-1 rounded border px-3 py-2"
                />
                <input
                  value={p.middleName}
                  onChange={(e) =>
                    setParticipants((prev) => prev.map((x, idx) => (idx === i ? { ...x, middleName: e.target.value } : x)))
                  }
                  placeholder="Middle name"
                  className="flex-1 rounded border px-3 py-2"
                />
                <input
                  value={p.lastName}
                  onChange={(e) =>
                    setParticipants((prev) => prev.map((x, idx) => (idx === i ? { ...x, lastName: e.target.value } : x)))
                  }
                  placeholder="Last name"
                  required
                  className="flex-1 rounded border px-3 py-2"
                />
                <select
                  value={p.gender}
                  onChange={(e) =>
                    setParticipants((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, gender: e.target.value as "M" | "F" } : x))
                    )
                  }
                  className="rounded border px-3 py-2"
                >
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
                {isGroup && (
                  <button
                    type="button"
                    onClick={() =>
                      setParticipants((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)))
                    }
                    disabled={participants.length <= 2}
                    className="text-sm text-red-600 disabled:opacity-30"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {isGroup && (
              <button
                type="button"
                onClick={() => setParticipants((prev) => [...prev, emptyParticipant()])}
                className="self-start text-sm text-blue-600"
              >
                + Add participant
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Coach(es) (1-2)</span>
            {coaches.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={c.fullName}
                  onChange={(e) =>
                    setCoaches((prev) => prev.map((x, idx) => (idx === i ? { ...x, fullName: e.target.value } : x)))
                  }
                  placeholder="Coach full name"
                  required
                  className="flex-1 rounded border px-3 py-2"
                />
                <select
                  value={c.gender}
                  onChange={(e) =>
                    setCoaches((prev) => prev.map((x, idx) => (idx === i ? { ...x, gender: e.target.value as "M" | "F" } : x)))
                  }
                  className="rounded border px-3 py-2"
                >
                  <option value="M">M</option>
                  <option value="F">F</option>
                </select>
                {coaches.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setCoaches((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-sm text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {coaches.length < 2 && (
              <button
                type="button"
                onClick={() => setCoaches((prev) => [...prev, emptyCoach()])}
                className="self-start text-sm text-blue-600"
              >
                + Add coach
              </button>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={isPending} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {isPending ? "Saving..." : "Save Entry"}
            </button>
            <button type="button" onClick={cancel} className="rounded border px-4 py-2 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
