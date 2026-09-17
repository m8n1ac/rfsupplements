import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Empty } from "@/components/crm/empty";
import { PageHeader } from "@/components/crm/page-header";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { formatDate, formatRelative, fullName } from "@/lib/format";
import { buildQuery, single, type Query } from "@/lib/search-params";
import { INQUIRY_STATUSES } from "@/lib/inquiry";
import type { Prisma } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Inquiries · RF Supplements Ops" };

export default async function InquiriesPage({ searchParams }: PageProps<"/inquiries">) {
  await requireUser();

  const query = (await searchParams) as Query;
  const view = single(query, "view") ?? "board";
  const form = single(query, "form");
  const assignee = single(query, "assignee");
  const age = single(query, "age");

  const now = new Date();
  const where: Prisma.InquiryWhereInput = {
    ...(form ? { formName: form } : {}),
    ...(assignee === "unassigned"
      ? { assigneeId: null }
      : assignee
        ? { assigneeId: assignee }
        : {}),
    ...(age ? { submittedAt: { lt: new Date(now.getTime() - Number(age) * 86_400_000) } } : {}),
  };

  const [inquiries, forms, staff] = await Promise.all([
    prisma.inquiry.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      include: {
        contact: { select: { id: true, email: true, firstName: true, lastName: true } },
        assignee: { select: { name: true } },
      },
    }),
    prisma.inquiry.findMany({ distinct: ["formName"], select: { formName: true } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);

  return (
    <div className="grid gap-6">
      <PageHeader title="Inquiries" description="Website form submissions, worked as a pipeline.">
        <Button asChild size="sm" variant={view === "board" ? "default" : "outline"}>
          <Link href={`/inquiries${buildQuery(query, { view: "board" })}`}>Board</Link>
        </Button>
        <Button asChild size="sm" variant={view === "list" ? "default" : "outline"}>
          <Link href={`/inquiries${buildQuery(query, { view: "list" })}`}>List</Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="flex flex-wrap gap-4 pt-6">
          <FilterGroup
            label="Form"
            current={form}
            options={forms.map((row) => ({ value: row.formName, label: row.formName }))}
            query={query}
            param="form"
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
          />
          <FilterGroup
            label="Age"
            current={age}
            options={[
              { value: "3", label: "Over 3 days" },
              { value: "7", label: "Over 7 days" },
              { value: "30", label: "Over 30 days" },
            ]}
            query={query}
            param="age"
          />
        </CardContent>
      </Card>

      {inquiries.length === 0 ? (
        <Empty>
          No inquiries yet. They arrive from the website forms once the bridge captures one.
        </Empty>
      ) : view === "list" ? (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Form</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inquiries.map((inquiry) => (
                  <TableRow key={inquiry.id}>
                    <TableCell>
                      <Link href={`/inquiries/${inquiry.id}`} className="font-medium hover:underline">
                        {inquiry.formName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {inquiry.contact ? fullName(inquiry.contact) : "—"}
                    </TableCell>
                    <TableCell><Badge variant="outline">{inquiry.status}</Badge></TableCell>
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
      ) : (
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
          {INQUIRY_STATUSES.map((status) => {
            const column = inquiries.filter((inquiry) => inquiry.status === status);
            return (
              <Card key={status} className="gap-3">
                <CardHeader className="pb-0">
                  <CardTitle className="flex items-center justify-between text-sm">
                    {status}
                    <Badge variant="secondary">{column.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {column.length === 0 ? (
                    <p className="text-muted-foreground text-xs">Empty</p>
                  ) : (
                    column.map((inquiry) => (
                      <Link
                        key={inquiry.id}
                        href={`/inquiries/${inquiry.id}`}
                        className="hover:bg-muted grid gap-1 rounded-md border p-3 text-sm"
                      >
                        <span className="font-medium">{inquiry.formName}</span>
                        <span className="text-muted-foreground text-xs">
                          {inquiry.contact ? fullName(inquiry.contact) : "no contact"}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {formatRelative(inquiry.submittedAt)}
                          {inquiry.assignee ? ` · ${inquiry.assignee.name}` : ""}
                        </span>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  current,
  options,
  query,
  param,
}: {
  label: string;
  current: string | undefined;
  options: { value: string; label: string }[];
  query: Query;
  param: string;
}) {
  if (options.length === 0) return null;

  return (
    <div className="grid gap-1.5">
      <span className="text-muted-foreground text-xs uppercase tracking-wide">{label}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <Button
            key={option.value}
            asChild
            size="sm"
            variant={current === option.value ? "secondary" : "ghost"}
          >
            <Link
              href={`/inquiries${buildQuery(query, {
                [param]: current === option.value ? undefined : option.value,
              })}`}
            >
              {option.label}
            </Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
