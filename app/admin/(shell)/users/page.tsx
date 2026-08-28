import Link from "next/link";
import { KeyRound, Lock, School, Users } from "lucide-react";

import { requireAdmin } from "@/app/admin/guard";
import { PageHeading } from "@/components/admin/shell/PageHeading";
import { StatCard } from "@/components/dashboard/StatCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeLockStamp, formatLockedAt } from "@/lib/submissions/lock-state";
import {
  filterUserAccountRows,
  summariseUserAccounts,
  toUserAccountRows,
  userAccountsEmptyState,
  type RawUserAccountSchool,
  type UserAccountsFilters,
} from "@/lib/schools/user-accounts-filters";
import { fetchAll } from "@/lib/supabase/fetch-all";

import { loadSubmissionsLock } from "../dashboard-data";
import { SubmissionsLockDialog } from "../SubmissionsLockDialog";
import { ProvisionLoginButton, UnlockAccountButton } from "./AccountRowActions";
import { AddSchoolDialog } from "./AddSchoolDialog";
import { UserAccountsFilterBar } from "./UserAccountsFilterBar";

interface DistrictRow {
  id: string;
  name: string;
}

export default async function UsersPage({
  searchParams,
}: {
  // Next 16: a Promise. `UserAccountsFilters` rather than a shape declared
  // here, so the page and the filter bar it hands these to cannot disagree
  // about a param's name.
  searchParams: Promise<UserAccountsFilters>;
}) {
  const { supabase } = await requireAdmin();
  const params = await searchParams;

  const [schoolRows, districtResult, submissionsLock] = await Promise.all([
    // Paged, not one select: PostgREST caps a response at `db-max-rows` and
    // says nothing, so an unbounded read would quietly shorten the roll — see
    // `fetchAll`'s doc. 336 schools today. `.order("id")` last because
    // `schools.name` carries no unique constraint, so ties would otherwise
    // reshuffle between page requests.
    //
    // `entries(count)` and `school_papers(count)` are embedded aggregates, not
    // joins: PostgREST computes them in the same statement, so the third
    // Submission state ("Closed", for a school that filed nothing) costs no
    // extra round-trip and no per-row query. With `paper_participation` they
    // are the three conditions `hasFiledAnything` reads.
    fetchAll<RawUserAccountSchool>("The school account list", (from, to) =>
      supabase
        .from("schools")
        .select(
          "id, name, school_id_number, district_id, auth_user_id, submission_locked_at, paper_participation, districts(name), entries(count), school_papers(count)"
        )
        .order("districts(name)")
        .order("name")
        .order("id")
        .range(from, to)
        .overrideTypes<RawUserAccountSchool[]>()
    ),
    supabase.from("districts").select("id, name").order("name").overrideTypes<DistrictRow[]>(),
    // `cache()`-memoized per request (React's cache does not share across
    // separate page loads, so this is still its own round-trip against
    // `/admin` — see `dashboard-data.ts`'s doc on `loadSubmissionsLock`), so
    // calling it again here costs nothing if anything else on this page ever
    // needs the lock state too.
    loadSubmissionsLock(),
  ]);

  const districts = districtResult.data ?? [];

  const allRows = toUserAccountRows(schoolRows);
  const rows = filterUserAccountRows(allRows, params);
  const summary = summariseUserAccounts(allRows);
  const empty = userAccountsEmptyState(params);
  const withoutLogin = summary.totalSchools - summary.schoolsWithLogin;
  // See `app/admin/(shell)/page.tsx` for why this is formatted once, on the
  // server, and handed to the dialog as a plain string rather than derived
  // inside it: Node's ICU and the browser's disagree about the space before
  // "PM", which is a hydration mismatch nobody can see.
  const lockStamp = describeLockStamp(submissionsLock);

  return (
    <div className="group flex flex-col gap-6">
      <PageHeading
        title="Users & Access"
        badge={`${rows.length} of ${summary.totalSchools}`}
        subtitle={
          <>
            {summary.schoolsWithLogin} of {summary.totalSchools} schools have a login —{" "}
            {summary.lockedCount} submission{summary.lockedCount === 1 ? "" : "s"} locked.
          </>
        }
        actions={<AddSchoolDialog districts={districts} />}
      />

      {/* A page-level control, not a per-school one — it freezes every row in
          the table below at once, independent of any school's own lock — so
          it gets its own card above the roll rather than a slot among the
          per-row actions the table already owns. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Division Wide Lock</CardTitle>
          <CardDescription>
            Freezes every school in the division at once, independent of any
            school&apos;s own lock.
            {lockStamp ? (
              // Not colour alone: the sentence says it.
              <span className="text-destructive"> {lockStamp}</span>
            ) : null}
          </CardDescription>
          <CardAction>
            <SubmissionsLockDialog lock={submissionsLock} stamp={lockStamp} />
          </CardAction>
        </CardHeader>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={School}
          label="Schools"
          value={summary.totalSchools}
          subtitle="On the division roll."
        />
        <StatCard
          icon={Users}
          label="Active logins"
          value={summary.schoolsWithLogin}
          subtitle="Can sign in and submit."
        />
        <StatCard
          icon={KeyRound}
          label="No login yet"
          value={withoutLogin}
          subtitle="Need a login provisioned before they can sign in."
        />
        <StatCard
          icon={Lock}
          label="Locked"
          value={summary.lockedCount}
          subtitle="Submission closed for the school; only an admin unlock can reopen it."
        />
      </section>

      <UserAccountsFilterBar districts={districts} />

      {/* Dimmed while the filter bar's navigation is still rendering on the
          server, so the table reads as catching up rather than as ignoring
          what was typed. Driven by `data-pending` on the bar above. */}
      <div className="overflow-x-auto rounded-xl border transition-opacity group-has-data-pending:opacity-50">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>School</TableHead>
              <TableHead>District</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Submission</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                {/* `whitespace-normal`, because `TableCell` sets
                    `whitespace-nowrap` in its base and this cell quotes back
                    whatever was typed — a pasted line would otherwise stretch
                    the table into a sideways scroll instead of wrapping. */}
                <TableCell colSpan={4} className="py-10 text-center whitespace-normal">
                  <p className="mx-auto max-w-[60ch] text-sm text-balance break-words text-muted-foreground">
                    {empty.message}
                  </p>
                  {empty.narrowed ? (
                    <Button asChild size="sm" variant="outline" className="mt-3">
                      <Link href="/admin/users">Show all schools</Link>
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.schoolId}>
                  <TableCell className="py-3">
                    <p className="font-medium">{row.schoolName}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {row.schoolIdNumber}
                    </p>
                  </TableCell>
                  <TableCell className="py-3 text-muted-foreground">
                    {row.districtName || "—"}
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {row.hasLogin ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <>
                          <Badge variant="outline">No login</Badge>
                          <ProvisionLoginButton
                            schoolId={row.schoolId}
                            schoolName={row.schoolName}
                          />
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {row.lockedAt ? (
                        <>
                          <div>
                            <Badge variant="outline">Locked</Badge>
                            {formatLockedAt(row.lockedAt) ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Since {formatLockedAt(row.lockedAt)}
                              </p>
                            ) : null}
                          </div>
                          <UnlockAccountButton
                            schoolId={row.schoolId}
                            schoolName={row.schoolName}
                          />
                        </>
                      ) : (
                        <Badge variant="secondary">Open</Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
