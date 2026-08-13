"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";

import {
  addCoachAction,
  addParticipantAction,
  deleteCoachAction,
  deleteParticipantAction,
} from "./roster-actions";
import type { RosterCoach, RosterParticipant } from "./types";
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
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-20">Gender</TableHead>
                <TableHead className="w-40">Events</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {participants.map((participant) => {
                const entry = usage[participant.id];
                const individual = entry?.individualCount ?? 0;
                const group = entry?.groupCount ?? 0;
                return (
                  <TableRow key={participant.id}>
                    <TableCell className="font-mono tabular-nums">
                      {participant.number_label}
                    </TableCell>
                    <TableCell className="font-medium">{participant.full_name}</TableCell>
                    <TableCell>{participant.gender}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {individual + group === 0
                        ? "—"
                        : `${individual} individual · ${group} group`}
                    </TableCell>
                    <TableCell>
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CoachesTab({ coaches, locked }: { coaches: RosterCoach[]; locked: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState<"M" | "F">("M");

  function handleAdd() {
    startTransition(async () => {
      const result = await addCoachAction({ fullName, gender });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setFullName("");
      setGender("M");
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
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="roster-coach-name">Complete name</Label>
          <Input
            id="roster-coach-name"
            value={fullName}
            disabled={locked}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
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
        <div className="sm:col-span-3">
          <Button type="button" disabled={locked || isPending} onClick={handleAdd}>
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
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-20">Gender</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {coaches.map((coach) => (
                <TableRow key={coach.id}>
                  <TableCell className="font-medium">{coach.full_name}</TableCell>
                  <TableCell>{coach.gender}</TableCell>
                  <TableCell>
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
        </div>
      )}
    </div>
  );
}
