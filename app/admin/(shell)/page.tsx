import Link from "next/link";
import type { ReactNode } from "react";

import { PageHeading } from "@/components/admin/shell/PageHeading";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AttentionList } from "@/components/dashboard/AttentionList";
import { EventDonut } from "@/components/dashboard/EventDonut";
import { KpiTile } from "@/components/dashboard/KpiTile";
import { PerSchoolTable } from "@/components/dashboard/PerSchoolTable";
import { PortalCard } from "@/components/dashboard/PortalCard";
import { RegistrationPortalCard } from "@/components/dashboard/RegistrationPortalCard";
import { SubmissionTimeline } from "@/components/dashboard/SubmissionTimeline";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { loadDashboardData } from "./dashboard-data";

/**
 * The timezone is pinned: this runs on a server whose clock is UTC, and an
 * unpinned formatter would print yesterday's date to a division office that is
 * eight hours ahead.
 */
const AS_OF = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});

/**
 * The comp's header line — spec §4 lists "SCHOOLS PRESS CONFERENCE 2026" as REAL, and
 * this is it. Static by design: nothing in the database names the competition or holds
 * its year, and adding a table for one string would be a schema change this plan does
 * not make. Edit this line next season.
 *
 * Stored in title case, not the comp's all-caps. The caps there are a type treatment,
 * not the string, and `PageHeading` renders its `title` as a `text-lg` h1 alongside
 * "Entries", "Schools" and "Districts" — shouting in one of six headings would read as
 * a mistake.
 */
const EVENT_TITLE = "Schools Press Conference 2026";

/**
 * The five data panels return bare markup — Task 14 gave a Card only to KpiTile and
 * PortalCard — so the page owns the card, the heading and the anchor around each one.
 * That is deliberate: it puts every panel title in one file, where they can be read as a
 * set, and it is what lets the "Needs attention" panel carry an id the topbar bell can
 * link to.
 *
 * `action` carries the per-school panel's two links. Task 22 fills the activity panel's
 * slot with a "View all" link; the slot exists so neither task has to reopen this
 * helper.
 */
function Panel({
  id,
  title,
  description,
  action,
  className,
  children,
}: {
  id?: string;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card id={id} className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function AdminDashboardPage() {
  const data = await loadDashboardData();

  return (
    <div className="space-y-6">
      <PageHeading
        title={EVENT_TITLE}
        badge={data.timeline.statusPill}
        subtitle={`Welcome back, ${data.adminName}. Division-wide figures as of ${AS_OF.format(data.now)}.`}
        actions={
          <Button asChild size="sm" variant="outline">
            {/* A route handler, not a page. `next/link` would prefetch it on hover and
                build a whole spreadsheet to throw away. */}
            <a href="/admin/export">Export entries</a>
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {data.kpis.map((kpi) => (
          <KpiTile key={kpi.key} kpi={kpi} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Registration by school"
          description="Learners, coaches and entries per school, the busiest first."
          action={
            <div className="flex items-center gap-2">
              <Button asChild size="sm" variant="ghost">
                <Link href="/admin/overall-data">
                  View all {data.perSchool.activeSchools} schools
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                {/* A route handler, so a plain anchor — next/link would build a
                    workbook on every hover. */}
                <a href="/admin/overall-data/export">Export to Excel</a>
              </Button>
            </div>
          }
        >
          <PerSchoolTable summary={data.perSchool} />
        </Panel>
        <Panel
          title="Entries by event type"
          description="Where the division's entries are concentrated."
        >
          <EventDonut summary={data.perEvent} />
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {/* The topbar bell links to /admin#attention, so this id is load-bearing. */}
        <Panel
          id="attention"
          title="Needs attention"
          description="Gaps a division admin can chase today."
        >
          <AttentionList items={data.attention} />
        </Panel>
        <Panel
          title="Recent activity"
          description="The newest changes the division's schools have made."
        >
          {/* `truncated` is passed, not omitted: six sources capped at 8 rows each merge
              down to 5 shown, so the feed is always holding something back and the
              component's notice must be able to say so. */}
          <ActivityFeed
            items={data.activity.items}
            now={data.now}
            truncated={data.activity.truncated}
          />
        </Panel>
        <Panel
          title="Submission timeline"
          description="How far the division has got through registration."
        >
          <SubmissionTimeline timeline={data.timeline} />
        </Panel>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <RegistrationPortalCard groups={data.eventGroups} />
        <PortalCard
          title="School Paper"
          description="Which schools are joining the school paper contest, how far each has got, and what they have submitted."
          actions={[{ label: "Go to portal", href: "/admin/school-papers" }]}
        />
        <PortalCard
          title="Judges"
          description="Judging panels, per-event assignments, and the sheets judges score on."
          soon
          requires={[
            "A judges table — the database has no judge, no panel and no assignment.",
            "A scoring model, so an assigned judge has something to open.",
          ]}
        />
        <PortalCard
          title="Tabulators"
          description="Score entry and per-event ranking for the tabulation team."
          soon
          requires={[
            "Scores to tabulate, which arrive with judging.",
            "A ranking and tie-break rule per event, agreed with the division office.",
          ]}
        />
      </section>
    </div>
  );
}
