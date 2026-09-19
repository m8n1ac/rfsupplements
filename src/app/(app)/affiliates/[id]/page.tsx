import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { formatDate, formatMoney, fullName } from "@/lib/format";
import { affiliateName } from "@/lib/affiliate";

export const metadata: Metadata = { title: "Affiliate · RF Supplements Ops" };

export default async function AffiliateDetailPage({ params }: PageProps<"/affiliates/[id]">) {
  await requireUser();
  const { id } = await params;

  const affiliate = await prisma.affiliate.findUnique({
    where: { id },
    include: {
      contact: { select: { id: true, email: true, firstName: true, lastName: true } },
      referrals: { orderBy: { createdAtWoo: "desc" } },
    },
  });

  if (!affiliate) {
    notFound();
  }

  // Referrals record a Woo order id, not a foreign key — the order may not be
  // synced, or may have been deleted in Woo. Resolve what we can and link only
  // those, rather than rendering links that 404.
  const orderIds = affiliate.referrals
    .map((referral) => referral.orderWooId)
    .filter((wooId): wooId is number => wooId !== null);

  const orders = orderIds.length
    ? await prisma.order.findMany({
        where: { wooId: { in: orderIds } },
        select: { wooId: true, number: true },
      })
    : [];
  const orderNumbers = new Map(orders.map((order) => [order.wooId, order.number]));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={affiliateName(affiliate)}
        description={`${affiliate.email} · ${Number(affiliate.commissionRate).toFixed(0)}% ${affiliate.commissionType.replace("_", " ")}`}
      >
        <Badge variant={affiliate.status === "approved" ? "secondary" : "outline"}>
          {affiliate.status}
        </Badge>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Commission owed" value={formatMoney(affiliate.unpaidCommission)} emphasis />
        <Figure label="Paid to date" value={formatMoney(affiliate.paidCommission)} />
        <Figure label="Referred revenue" value={formatMoney(affiliate.referredRevenue)} />
        <Figure label="Referrals" value={String(affiliate.referralCount)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Who this is</CardTitle>
          <CardDescription>
            Solid Affiliate owns this record; the CRM mirrors it read-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Contact">
            {affiliate.contact ? (
              <Link href={`/contacts/${affiliate.contact.id}`} className="underline">
                {fullName(affiliate.contact)}
              </Link>
            ) : (
              <span className="text-muted-foreground">
                no matching contact — they have not ordered
              </span>
            )}
          </Field>
          <Field label="Payment email">
            {affiliate.paymentEmail ?? <span className="text-muted-foreground">not set</span>}
          </Field>
          <Field label="Joined">{formatDate(affiliate.createdAtWoo)}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Referrals</CardTitle>
          <CardDescription>
            Rejected referrals are excluded from referred revenue.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {affiliate.referrals.length === 0 ? (
            <Empty>No referrals yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Order amount</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {affiliate.referrals.map((referral) => (
                  <TableRow key={referral.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(referral.createdAtWoo)}
                    </TableCell>
                    <TableCell>
                      {referral.orderWooId === null ? (
                        "—"
                      ) : orderNumbers.has(referral.orderWooId) ? (
                        <Link href={`/orders/${referral.orderWooId}`} className="hover:underline">
                          #{orderNumbers.get(referral.orderWooId)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          #{referral.orderWooId} (not in CRM)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {referral.referralSource ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={referral.status === "unpaid" ? "default" : "outline"}>
                        {referral.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(referral.orderAmount)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(referral.commissionAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Figure({
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <span className="text-muted-foreground text-xs tracking-wide uppercase">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}
