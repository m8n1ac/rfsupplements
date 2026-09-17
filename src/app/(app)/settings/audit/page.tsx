import type { Metadata } from "next";
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
import { PageHeader } from "@/components/crm/page-header";
import { Pagination } from "@/components/crm/pagination";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { formatDateTime } from "@/lib/format";
import { buildQuery, PAGE_SIZE, pageNumber, type Query } from "@/lib/search-params";

export const metadata: Metadata = { title: "Audit log · RF Supplements Ops" };

export default async function AuditPage({ searchParams }: PageProps<"/settings/audit">) {
  await requireUser("ADMIN");

  const query = (await searchParams) as Query;
  const page = pageNumber(query);

  const [entries, total] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { at: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count(),
  ]);

  return (
    <div className="grid gap-6">
      <PageHeader title="Audit log" description="Who changed what, and when." />

      {entries.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDateTime(entry.at)}
                    </TableCell>
                    <TableCell>{entry.user?.name ?? "system"}</TableCell>
                    <TableCell><code className="text-xs">{entry.action}</code></TableCell>
                    <TableCell className="text-muted-foreground">
                      {entry.entity}
                      {entry.entityId ? ` · ${entry.entityId.slice(0, 8)}…` : ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Pagination
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
        total={total}
        buildHref={(next) => `/settings/audit${buildQuery(query, { page: next })}`}
      />
    </div>
  );
}
