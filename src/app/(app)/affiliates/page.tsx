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
import { formatDate, formatMoney } from "@/lib/format";
import { single, type Query } from "@/lib/search-params";
import { affiliateName } from "@/lib/affiliate";

export const metadata: Metadata = { title: "Affiliates · RF Supplements Ops" };

export default async function AffiliatesPage({ searchParams }: PageProps<"/affiliates">) {
  await requireUser();

  const query = (await searchParams) as Query;
  const status = single(query, "status");

  const [affiliates, statuses, totals] = await Promise.all([
    prisma.affiliate.findMany({
      where: status ? { status } : {},
      orderBy: [{ unpaidCommission: "desc" }, { referredRevenue: "desc" }],
      include: { contact: { select: { id: true } } },
    }),
    prisma.affiliate.findMany({ distinct: ["status"], select: { status: true } }),
    prisma.affiliate.aggregate({
      _sum: { unpaidCommission: true, paidCommission: true, referredRevenue: true },
      _count: true,
    }),
  ]);

  // Every affiliate in this programme is "approved". A column repeating one word
  // twenty times and a filter offering a single choice are both noise, so status
  // is shown only once it distinguishes anything — which is also the moment it
  // starts to matter.
  const statusVaries = statuses.length > 1;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Affiliates"
        description="Mirrored from Solid Affiliate, which stays the only writer. Commission is never recalculated here."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Affiliates" value={String(totals._count)} />
        <StatCard
          label="Commission owed"
          value={formatMoney(totals._sum.unpaidCommission ?? 0)}
          emphasis
        />
        <StatCard label="Paid to date" value={formatMoney(totals._sum.paidCommission ?? 0)} />
        <StatCard label="Referred revenue" value={formatMoney(totals._sum.referredRevenue ?? 0)} />
      </div>

      {statusVaries ? (
        <Card>
          <CardContent className="flex flex-wrap gap-4 pt-6">
            <FilterGroup
              label="Status"
              current={status}
              options={statuses.map((row) => ({ value: row.status, label: row.status }))}
              query={query}
              param="status"
              basePath="/affiliates"
            />
          </CardContent>
        </Card>
      ) : null}

      {affiliates.length === 0 ? (
        <Empty>No affiliates match this filter.</Empty>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Affiliate</TableHead>
                  {statusVaries ? <TableHead>Status</TableHead> : null}
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Referrals</TableHead>
                  <TableHead className="text-right">Referred revenue</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Last referral</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affiliates.map((affiliate) => (
                  <TableRow key={affiliate.id}>
                    <TableCell>
                      <Link
                        href={`/affiliates/${affiliate.id}`}
                        className="font-medium hover:underline"
                      >
                        {affiliateName(affiliate)}
                      </Link>
                      <div className="text-muted-foreground text-xs">{affiliate.email}</div>
                    </TableCell>
                    {statusVaries ? (
                      <TableCell>
                        <Badge variant={affiliate.status === "approved" ? "secondary" : "outline"}>
                          {affiliate.status}
                        </Badge>
                      </TableCell>
                    ) : null}
                    <TableCell className="text-muted-foreground text-right">
                      {Number(affiliate.commissionRate).toFixed(0)}%
                    </TableCell>
                    <TableCell className="text-right">{affiliate.referralCount}</TableCell>
                    <TableCell className="text-right">
                      {formatMoney(affiliate.referredRevenue)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {Number(affiliate.unpaidCommission) > 0
                        ? formatMoney(affiliate.unpaidCommission)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right">
                      {formatMoney(affiliate.paidCommission)}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(affiliate.lastReferralAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-muted-foreground text-xs tracking-wide uppercase">{label}</div>
        <div className={`mt-1 text-2xl font-semibold${emphasis ? " text-amber-600 dark:text-amber-500" : ""}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
