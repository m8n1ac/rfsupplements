import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty } from "@/components/crm/empty";
import { FilterGroup } from "@/components/crm/filter-group";
import { PageHeader } from "@/components/crm/page-header";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { formatDate, fullName } from "@/lib/format";
import { single, type Query } from "@/lib/search-params";
import { INQUIRY_STATUSES } from "@/lib/inquiry";
import { ATHLETE_FORM_NAME, ATHLETE_TIERS, athleteApplication } from "@/lib/athlete";

export const metadata: Metadata = { title: "Athlete Program · RF Supplements Ops" };

export default async function AthletesPage({ searchParams }: PageProps<"/athletes">) {
  await requireUser();

  const query = (await searchParams) as Query;
  const tier = single(query, "tier");
  const status = single(query, "status");
  const assignee = single(query, "assignee");

  const [rows, staff] = await Promise.all([
    prisma.inquiry.findMany({
      where: {
        formName: ATHLETE_FORM_NAME,
        ...(status ? { status: status as never } : {}),
        ...(assignee === "unassigned"
          ? { assigneeId: null }
          : assignee
            ? { assigneeId: assignee }
            : {}),
      },
      orderBy: { submittedAt: "desc" },
      include: {
        contact: { select: { id: true, email: true, firstName: true, lastName: true } },
        assignee: { select: { name: true } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);

  // Tier lives inside the form payload, which is JSON. Applications arrive at a
  // handful a week, so the tier filter and the counts are done in memory rather
  // than pushed into a JSON path query — it keeps one code path for a field
  // whose spelling is controlled by a WordPress form, not by a migration.
  const applications = rows.map((row) => ({ inquiry: row, app: athleteApplication(row.payload) }));
  const visible = tier ? applications.filter((row) => row.app.tier === tier) : applications;

  const tierCounts = ATHLETE_TIERS.map((name) => ({
    name,
    count: applications.filter((row) => row.app.tier === name).length,
  }));
  const newCount = applications.filter((row) => row.inquiry.status === "NEW").length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Athlete Program"
        description="Sponsorship applications submitted from the Athlete Program page."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Applications" value={applications.length} />
        <StatCard label="Awaiting review" value={newCount} />
        {tierCounts.map((row) => (
          <StatCard key={row.name} label={row.name} value={row.count} />
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-4 pt-6">
          <FilterGroup
            label="Tier"
            current={tier}
            options={ATHLETE_TIERS.map((name) => ({ value: name, label: name }))}
            query={query}
            param="tier"
            basePath="/athletes"
          />
          <FilterGroup
            label="Status"
            current={status}
            options={INQUIRY_STATUSES.map((name) => ({ value: name, label: name }))}
            query={query}
            param="status"
            basePath="/athletes"
          />
          <FilterGroup
            label="Assignee"
            current={assignee}
            options={[
              { value: "unassigned", label: "Unassigned" },
              ...staff.map((member) => ({ value: member.id, label: member.name })),
            ]}
            query={query}
            param="assignee"
            basePath="/athletes"
          />
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Empty>
          {applications.length === 0
            ? "No athlete applications yet. They arrive from the Athlete Program form on the website."
            : "No applications match these filters."}
        </Empty>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Sport</TableHead>
                  <TableHead>Instagram</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(({ inquiry, app }) => (
                  <TableRow key={inquiry.id}>
                    <TableCell>
                      <Link
                        href={`/athletes/${inquiry.id}`}
                        className="font-medium hover:underline"
                      >
                        {app.name ?? (inquiry.contact ? fullName(inquiry.contact) : "—")}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {app.email ?? inquiry.contact?.email ?? ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      {app.tier ? <Badge variant="secondary">{app.tier}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{app.sport ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {app.instagramUrl ? (
                        <a
                          href={app.instagramUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="hover:underline"
                        >
                          @{app.instagram}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{inquiry.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inquiry.assignee?.name ?? "unassigned"}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(inquiry.submittedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        The Athlete Program and the affiliate programme are separate. An application is a
        sponsorship request reviewed here; it creates nothing elsewhere.
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-muted-foreground text-xs tracking-wide uppercase">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
