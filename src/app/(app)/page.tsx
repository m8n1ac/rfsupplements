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
import { PageHeader } from "@/components/crm/page-header";
import { StatTile } from "@/components/crm/stat-tile";
import { ChartShell } from "@/components/charts/chart-shell";
import { NetSalesChart } from "@/components/charts/net-sales-chart";
import { BarList } from "@/components/charts/bar-list";
import { PeriodPicker } from "@/app/(app)/period-picker";
import { requireUser } from "@/lib/require-user";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/format";
import { isPeriodKey, priorPeriod, resolvePeriod } from "@/lib/metrics/period";
import {
  netSalesSeries,
  ordersByState,
  paymentMethodMix,
  revenueTotals,
  topCoupons,
  topCustomers,
  topProducts,
} from "@/lib/metrics/revenue";
import { ltvDistribution, opsQueues } from "@/lib/metrics/ops";
import { single, type Query } from "@/lib/search-params";

export const metadata: Metadata = { title: "Dashboard · RF Supplements Ops" };

/** Fractional change, or null when the prior period gives no basis to compare. */
function delta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return (current - prior) / prior;
}

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const query = (await searchParams) as Query;

  const periodKey = (() => {
    const raw = single(query, "period");
    return isPeriodKey(raw) ? raw : "30d";
  })();

  const now = new Date();
  const period = resolvePeriod(periodKey, env.STORE_TZ, now, {
    from: single(query, "from"),
    to: single(query, "to"),
  });
  const prior = priorPeriod(period);

  const ops = await opsQueues(user.id, now);

  return (
    <div className="grid gap-6">
      <PageHeader title="Dashboard" description={`${period.label} · times in ${env.STORE_TZ}`}>
        {ops.syncHealthy ? (
          <Badge variant="secondary">sync healthy</Badge>
        ) : (
          <Badge variant="destructive" title={`Stale: ${ops.staleResources.join(", ")}`}>
            sync stale
          </Badge>
        )}
      </PageHeader>

      {user.role === "ADMIN" ? <PeriodPicker active={periodKey} /> : null}

      {/* Ops queues come first: they are what a shift actually works from, and
          both roles see them. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <OpsTile label="Processing over 48h" value={ops.processingOver48h} href="/orders?status=processing" />
        <OpsTile label="On hold or pending" value={ops.onHoldOrPending} href="/orders?status=on-hold" />
        <OpsTile label="Failed in last 7 days" value={ops.failedLast7Days} href="/orders?status=failed" />
        <OpsTile label="Unassigned new inquiries" value={ops.unassignedNewInquiries} href="/inquiries?assignee=unassigned" />
        <OpsTile label="No reply after 24h" value={ops.inquiriesAwaitingFirstResponse} href="/inquiries" />
        <OpsTile label="Out of or low stock" value={ops.lowOrOutOfStock} href="/products?stock=outofstock" />
        <OpsTile label="My tasks due or overdue" value={ops.myTasksDueOrOverdue} href="/tasks?scope=mine&due=today" />
        <OpsTile
          label="Sync"
          value={ops.syncHealthy ? "OK" : "Stale"}
          href="/settings/sync"
          alert={!ops.syncHealthy}
        />
      </div>

      {user.role === "ADMIN" ? <AdminSection period={period} prior={prior} /> : null}
    </div>
  );
}

function OpsTile({
  label,
  value,
  href,
  alert,
}: {
  label: string;
  value: number | string;
  href: string;
  alert?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className={alert ? "border-destructive hover:border-destructive" : "hover:border-foreground/20 transition-colors"}>
        <CardContent className="py-5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${alert ? "text-destructive" : ""}`}>
            {value}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

async function AdminSection({
  period,
  prior,
}: {
  period: { from: Date; to: Date; label: string };
  prior: { from: Date; to: Date };
}) {
  const [totals, priorTotals, series, priorSeries, products, coupons, payments, states, customers, ltv] =
    await Promise.all([
      revenueTotals(period),
      revenueTotals(prior),
      netSalesSeries(period, env.STORE_TZ),
      netSalesSeries(prior, env.STORE_TZ),
      topProducts(period),
      topCoupons(period),
      paymentMethodMix(period),
      ordersByState(period),
      topCustomers(),
      ltvDistribution(),
    ]);

  // The prior period is aligned by position, not by date: day 1 against day 1.
  const chartData = series.map((point, index) => ({
    label: point.day.slice(5),
    current: point.netSales,
    prior: priorSeries[index]?.netSales ?? null,
  }));

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Net sales"
          value={formatMoney(totals.netSales)}
          delta={delta(Number(totals.netSales), Number(priorTotals.netSales))}
        />
        <StatTile
          label="Total sales"
          value={formatMoney(totals.totalSales)}
          delta={delta(Number(totals.totalSales), Number(priorTotals.totalSales))}
        />
        <StatTile label="Orders" value={String(totals.orders)} delta={delta(totals.orders, priorTotals.orders)} />
        <StatTile
          label="Average order"
          value={formatMoney(totals.averageOrderValue)}
          delta={delta(Number(totals.averageOrderValue), Number(priorTotals.averageOrderValue))}
        />
        <StatTile label="Items sold" value={String(totals.itemsSold)} delta={delta(totals.itemsSold, priorTotals.itemsSold)} />
        <StatTile
          label="New customers"
          value={String(totals.newCustomers)}
          delta={delta(totals.newCustomers, priorTotals.newCustomers)}
        />
        <StatTile
          label="Returning rate"
          value={`${(totals.returningRate * 100).toFixed(1)}%`}
          delta={delta(totals.returningRate, priorTotals.returningRate)}
        />
        <StatTile
          label="Refunds"
          value={formatMoney(totals.refunds)}
          delta={delta(Number(totals.refunds), Number(priorTotals.refunds))}
          invertDelta
        />
      </div>

      <ChartShell
        title="Net sales over time"
        description="Bars are this period; the line is the period immediately before it, aligned day for day."
      >
        {chartData.length === 0 ? (
          <Empty>No paid orders in this period.</Empty>
        ) : (
          <NetSalesChart data={chartData} />
        )}
      </ChartShell>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartShell title="Top products by net sales" description="Line-item totals for paid orders in the period.">
          {products.length === 0 ? (
            <Empty>Nothing sold in this period.</Empty>
          ) : (
            <>
              <BarList data={products.map((p) => ({ label: p.name, value: p.netSales }))} />
              <ValueTable
                head={["Product", "Units", "Net"]}
                rows={products.map((p) => [p.name, String(p.units), formatMoney(p.netSales.toFixed(2))])}
              />
            </>
          )}
        </ChartShell>

        <ChartShell title="Top coupons by discount" description="An order's discount is split evenly across its coupons.">
          {coupons.length === 0 ? (
            <Empty>No coupons used in this period.</Empty>
          ) : (
            <>
              <BarList data={coupons.map((c) => ({ label: c.code, value: c.discount }))} />
              <ValueTable
                head={["Coupon", "Orders", "Discount"]}
                rows={coupons.map((c) => [c.code, String(c.orders), formatMoney(c.discount.toFixed(2))])}
              />
            </>
          )}
        </ChartShell>

        <ChartShell title="Payment methods" description="Order totals by gateway.">
          {payments.length === 0 ? (
            <Empty>No payments in this period.</Empty>
          ) : (
            <BarList data={payments.map((p) => ({ label: p.label, value: p.value }))} height={220} />
          )}
        </ChartShell>

        <ChartShell title="Orders by billing state" description="Where the period's orders came from.">
          {states.length === 0 ? (
            <Empty>No billing states recorded in this period.</Empty>
          ) : (
            <BarList data={states.map((s) => ({ label: s.label, value: s.orders }))} unit="count" height={220} />
          )}
        </ChartShell>

        <ChartShell title="Lifetime value distribution" description="All contacts who have ever ordered, not just this period.">
          <BarList data={ltv.map((b) => ({ label: b.label, value: b.contacts }))} unit="count" height={220} />
        </ChartShell>

        <ChartShell title="Top customers" description="By lifetime value, all time.">
          {customers.length === 0 ? (
            <Empty>No customers yet.</Empty>
          ) : (
            <ValueTable
              head={["Customer", "Orders", "Lifetime"]}
              rows={customers.map((c) => [c.email, String(c.orders), formatMoney(c.lifetimeValue.toFixed(2))])}
            />
          )}
        </ChartShell>
      </div>
    </div>
  );
}

// Charts ship with the numbers beside them: the light-mode palette puts one
// series below 3:1 on the surface, so the table is the required relief.
function ValueTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="max-h-64 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((cell, index) => (
              <TableHead key={cell} className={index === 0 ? "" : "text-right"}>
                {cell}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.join("|")}>
              {row.map((cell, index) => (
                <TableCell key={cell + index} className={index === 0 ? "max-w-52 truncate" : "text-right tabular-nums"}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
