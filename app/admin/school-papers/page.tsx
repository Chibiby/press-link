import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireAdmin } from "../guard";
import { adminSignOutAction } from "../actions";
import { SchoolPaperFilterBar } from "./SchoolPaperFilterBar";
import { UnlockPaperButton } from "./UnlockPaperButton";
import { DashboardHeader } from "@/components/dashboard-header";
import {
  toAdminSchoolPaperRows,
  filterSchoolPaperRows,
  type RawAdminSchoolPaper,
} from "@/lib/paper/admin-papers";
import { PAPER_STATUS_LABEL } from "@/lib/paper/status";
import { LANGUAGE_LABEL } from "@/lib/events-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const DATE_FORMAT = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface SearchParams {
  district?: string;
  school?: string;
  status?: string;
  lock?: string;
  language?: string;
}

export default async function AdminSchoolPapersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { supabase } = await requireAdmin();

  const [{ data: districts }, { data: schools }, { data: raw }] = await Promise.all([
    supabase.from("districts").select("id, name").order("name"),
    supabase.from("schools").select("id, name").order("name"),
    supabase
      .from("schools")
      .select(
        "id, name, district_id, paper_participation, paper_answered_at, paper_locked_at, districts(name), school_papers(language)"
      )
      .order("name")
      .overrideTypes<RawAdminSchoolPaper[]>(),
  ]);

  const allRows = toAdminSchoolPaperRows(raw ?? []);
  const rows = filterSchoolPaperRows(allRows, params);

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardHeader
        title="School Papers"
        subtitle="Every school's paper on record"
        badge={`${rows.length} of ${allRows.length}`}
        signOutAction={adminSignOutAction}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex justify-end">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin">
                <ArrowLeft className="size-4" />
                Back to entries
              </Link>
            </Button>
          </div>

          <SchoolPaperFilterBar districts={districts ?? []} schools={schools ?? []} />

          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>School</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Languages</TableHead>
                  <TableHead>Answered</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.schoolName}</TableCell>
                    <TableCell className="text-muted-foreground">{row.districtName}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={row.status === "submitted" ? "default" : "secondary"}
                          className="text-[10px]"
                        >
                          {PAPER_STATUS_LABEL[row.status]}
                        </Badge>
                        {row.locked && (
                          <Badge variant="outline" className="text-[10px]">
                            Locked
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.languages.length === 0 ? (
                        "—"
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          {row.languages.map((lang) => (
                            <Badge key={lang} variant="outline" className="text-[10px]">
                              {LANGUAGE_LABEL[lang]}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {row.answeredAt ? DATE_FORMAT.format(new Date(row.answeredAt)) : "—"}
                    </TableCell>
                    <TableCell>
                      {row.locked && (
                        <UnlockPaperButton schoolId={row.id} schoolName={row.schoolName} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No schools match these filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </main>
    </div>
  );
}
