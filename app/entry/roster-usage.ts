import type { UsageMap } from "@/lib/roster/limits";

/**
 * Only the counts that are non-zero: "0 group" on every row is noise in a
 * column narrow enough to sit beside the entries list.
 */
function usageParts(usage: UsageMap[string] | undefined): string[] {
  const individual = usage?.individualCount ?? 0;
  const group = usage?.groupCount ?? 0;

  const parts: string[] = [];
  if (individual > 0) parts.push(`${individual} individual`);
  if (group > 0) parts.push(`${group} group`);

  return parts;
}

/**
 * How many entries a participant already sits in, as the Events column reads.
 *
 * A participant in no entry reads better as an em dash than as two zeroes.
 */
export function eventUsageLabel(usage: UsageMap[string] | undefined): string {
  const parts = usageParts(usage);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * Gender and Events as one line, for the narrow layout where both columns fold
 * in under the name. Spelled out, since neither has a header to read there, and
 * a participant in no entry contributes nothing rather than a dangling dash.
 */
export function participantMetaLabel(
  gender: "M" | "F",
  usage: UsageMap[string] | undefined
): string {
  return [gender === "F" ? "Female" : "Male", ...usageParts(usage)].join(" · ");
}
