"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import {
  addCoachAction,
  addParticipantAction,
  deleteCoachAction,
  deleteParticipantAction,
} from "./roster-actions";
import {
  ANY,
  filterCoaches,
  filterParticipants,
  type AssignmentFilter,
  type GenderFilter,
} from "./list-filters";
import { ListPager, useListPage } from "./ListPager";
import { ListToolbar } from "./ListToolbar";
import type { RosterCoach, RosterParticipant } from "./types";
import { eventUsageLabel, participantMetaLabel } from "./roster-usage";
import { type UsageMap } from "@/lib/roster/limits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * The remove button rides along the right edge, so it stays reachable no matter
 * how far a long name pushes the row sideways.
 */
const ACTION_CELL =
  "sticky right-0 w-12 border-l bg-background group-hover/row:bg-muted/50";

export function RosterPanel({
  participants,
  coaches,
  usage,
  locked,
}: {
  participants: RosterParticipant[];
  coaches: RosterCoach[];
  usage: UsageMap;
  locked: boolean;
}) {
  return (
    <Tabs defaultValue="participants">
      <TabsList className="w-full">
        <TabsTrigger value="participants" className="flex-1 gap-2">
          Participants
          <Badge variant="secondary" className="text-[10px]">
            {participants.length}
          </Badge>
        </TabsTrigger>
        <TabsTrigger value="coaches" className="flex-1 gap-2">
          Coaches
          <Badge variant="secondary" className="text-[10px]">
            {coaches.length}
          </Badge>
        </TabsTrigger>
      </TabsList>

      <TabsContent value="participants" className="pt-4">
        <ParticipantsTab participants={participants} usage={usage} locked={locked} />
      </TabsContent>
      <TabsContent value="coaches" className="pt-4">
        <CoachesTab coaches={coaches} locked={locked} />
      </TabsContent>
    </Tabs>
  );
}

function ParticipantsTab({
  participants,
  usage,
  locked,
}: {
  participants: RosterParticipant[];
  usage: UsageMap;
  locked: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");
  const [query, setQuery] = useState("");
  const [assignment, setAssignment] = useState<AssignmentFilter>(ANY);

  // The whole roster is already on the client, so narrowing it is a render away.
  const shown = useMemo(
    () => filterParticipants(participants, { query, usage, assignment }),
    [participants, query, usage, assignment]
  );
  const { rows, topRef, reset, pager } = useListPage(shown);

  function clearFilters() {
    setQuery("");
    setAssignment(ANY);
    reset();
  }

  function handleAdd() {
    startTransition(async () => {
      const result = await addParticipantAction({ firstName, middleName, lastName, gender });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setFirstName("");
      setMiddleName("");
      setLastName("");
      setGender("M");
      // A filter left over from a search would hide the row that was just
      // added, so the school would think the add failed.
      clearFilters();
      toast.success("Participant added.");
      router.refresh();
    });
  }

  function handleDelete(participant: RosterParticipant) {
    startTransition(async () => {
      const result = await deleteParticipantAction(participant.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${participant.full_name} removed.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-first-name">First name</Label>
          <Input
            id="roster-first-name"
            value={firstName}
            disabled={locked}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-middle-name">Middle name</Label>
          <Input
            id="roster-middle-name"
            value={middleName}
            disabled={locked}
            onChange={(e) => setMiddleName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-last-name">Last name</Label>
          <Input
            id="roster-last-name"
            value={lastName}
            disabled={locked}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>Gender</Label>
          <RadioGroup
            value={gender}
            disabled={locked}
            onValueChange={(v) => setGender(v as "M" | "F")}
            className="flex h-9 items-center gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="M" id="roster-gender-m" />
              <Label htmlFor="roster-gender-m" className="text-sm font-normal">
                Male
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="F" id="roster-gender-f" />
              <Label htmlFor="roster-gender-f" className="text-sm font-normal">
                Female
              </Label>
            </div>
          </RadioGroup>
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            className="w-full"
            disabled={locked || isPending}
            onClick={handleAdd}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add participant
          </Button>
        </div>
      </div>

      {participants.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No participants yet. Add your contestants here before creating entries.
        </p>
      ) : (
        <div ref={topRef} className="flex scroll-mt-28 flex-col gap-3">
          <ListToolbar
            searchPlaceholder="Search name or number"
            query={query}
            onQueryChange={(value) => {
              // A new search re-numbers the pages under it, so page 4 of the
              // old list is not a place to stay.
              setQuery(value);
              reset();
            }}
            filters={[
              {
                value: assignment,
                onChange: (value) => {
                  setAssignment(value as AssignmentFilter);
                  reset();
                },
                placeholder: "All participants",
                options: [
                  { value: "assigned", label: "In an entry" },
                  { value: "unassigned", label: "Not in an entry" },
                ],
                ariaLabel: "Filter participants by entry status",
              },
            ]}
            shown={shown.length}
            total={participants.length}
            onClear={clearFilters}
          />

          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
              No participants match{" "}
              {query.trim() ? `“${query.trim()}”` : "this filter"}.{" "}
              <Button variant="link" className="h-auto p-0" onClick={clearFilters}>
                Clear
              </Button>
            </p>
          ) : (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">No.</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden w-14 sm:table-cell">Gender</TableHead>
                  <TableHead className="hidden w-28 sm:table-cell">Events</TableHead>
                  <TableHead className={ACTION_CELL} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((participant) => (
                  <TableRow key={participant.id} className="group/row">
                    <TableCell className="font-mono text-xs tabular-nums">
                      {participant.number_label}
                    </TableCell>
                    <TableCell className="font-medium whitespace-normal">
                      {participant.full_name}
                      {/* Too narrow for their own columns, Gender and Events fold in
                          here, so a phone reads down the list instead of sideways. */}
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground sm:hidden">
                        {participantMetaLabel(participant.gender, usage[participant.id])}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {participant.gender}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {eventUsageLabel(usage[participant.id])}
                    </TableCell>
                    <TableCell className={ACTION_CELL}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${participant.full_name}`}
                        disabled={locked || isPending}
                        onClick={() => handleDelete(participant)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <ListPager {...pager} label="Participants" />
        </div>
      )}
    </div>
  );
}

function CoachesTab({ coaches, locked }: { coaches: RosterCoach[]; locked: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");
  const [query, setQuery] = useState("");
  const [genderFilter, setGenderFilter] = useState<GenderFilter>(ANY);

  const shown = useMemo(
    () => filterCoaches(coaches, { query, gender: genderFilter }),
    [coaches, query, genderFilter]
  );
  const { rows, topRef, reset, pager } = useListPage(shown);

  function clearFilters() {
    setQuery("");
    setGenderFilter(ANY);
    reset();
  }

  function handleAdd() {
    startTransition(async () => {
      const result = await addCoachAction({ firstName, middleName, lastName, gender });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setFirstName("");
      setMiddleName("");
      setLastName("");
      setGender("M");
      // A filter left over from a search would hide the row that was just
      // added, so the school would think the add failed.
      clearFilters();
      toast.success("Coach added.");
      router.refresh();
    });
  }

  function handleDelete(coach: RosterCoach) {
    startTransition(async () => {
      const result = await deleteCoachAction(coach.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${coach.full_name} removed.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-coach-first-name">First name</Label>
          <Input
            id="roster-coach-first-name"
            value={firstName}
            disabled={locked}
            onChange={(e) => setFirstName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-coach-middle-name">Middle name</Label>
          <Input
            id="roster-coach-middle-name"
            value={middleName}
            disabled={locked}
            onChange={(e) => setMiddleName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="roster-coach-last-name">Last name</Label>
          <Input
            id="roster-coach-last-name"
            value={lastName}
            disabled={locked}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label>Gender</Label>
          <RadioGroup
            value={gender}
            disabled={locked}
            onValueChange={(v) => setGender(v as "M" | "F")}
            className="flex h-9 items-center gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="M" id="roster-coach-gender-m" />
              <Label htmlFor="roster-coach-gender-m" className="text-sm font-normal">
                Male
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="F" id="roster-coach-gender-f" />
              <Label htmlFor="roster-coach-gender-f" className="text-sm font-normal">
                Female
              </Label>
            </div>
          </RadioGroup>
        </div>
        <div className="flex items-end">
          <Button
            type="button"
            className="w-full"
            disabled={locked || isPending}
            onClick={handleAdd}
          >
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add coach
          </Button>
        </div>
      </div>

      {coaches.length === 0 ? (
        <p className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          No coaches yet. Add them here so entries can select them.
        </p>
      ) : (
        <div ref={topRef} className="flex scroll-mt-28 flex-col gap-3">
          <ListToolbar
            searchPlaceholder="Search coaches"
            query={query}
            onQueryChange={(value) => {
              setQuery(value);
              reset();
            }}
            filters={[
              {
                value: genderFilter,
                onChange: (value) => {
                  setGenderFilter(value as GenderFilter);
                  reset();
                },
                placeholder: "All coaches",
                options: [
                  { value: "M", label: "Male" },
                  { value: "F", label: "Female" },
                ],
                ariaLabel: "Filter coaches by gender",
              },
            ]}
            shown={shown.length}
            total={coaches.length}
            onClear={clearFilters}
          />

          {shown.length === 0 ? (
            <p className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
              No coaches match {query.trim() ? `“${query.trim()}”` : "this filter"}.{" "}
              <Button variant="link" className="h-auto p-0" onClick={clearFilters}>
                Clear
              </Button>
            </p>
          ) : (
            <Table containerClassName="rounded-xl border">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-14">Gender</TableHead>
                  <TableHead className={ACTION_CELL} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((coach) => (
                  <TableRow key={coach.id} className="group/row">
                    <TableCell className="font-medium whitespace-normal">
                      {coach.full_name}
                    </TableCell>
                    <TableCell>{coach.gender}</TableCell>
                    <TableCell className={ACTION_CELL}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${coach.full_name}`}
                        disabled={locked || isPending}
                        onClick={() => handleDelete(coach)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <ListPager {...pager} label="Coaches" />
        </div>
      )}
    </div>
  );
}
