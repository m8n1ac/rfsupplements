// Gate 4: proves src/lib/metrics matches WooCommerce Analytics to the cent.
//
//   npm run verify:metrics
//
// Comparisons run in UTC, because Woo Analytics groups by the WordPress site
// timezone and this store's is UTC. The dashboard itself reports in STORE_TZ;
// the maths is identical, only the window boundaries differ (Gate 0, A2).
import "dotenv/config";

import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import { revenueTotals } from "../src/lib/metrics/revenue";
import { resolvePeriod, zonedStartOfDay, type Range } from "../src/lib/metrics/period";

const authorization = `Basic ${Buffer.from(
  `${env.WOO_USER}:${env.WOO_APP_PASSWORD}`,
).toString("base64")}`;

type WooTotals = {
  orders_count: number;
  num_items_sold: number;
  gross_sales: number;
  coupons: number;
  refunds: number;
  shipping: number;
  taxes: number;
  net_revenue: number;
  total_sales: number;
  avg_order_value: number;
};

// Woo takes site-local datetimes; the site is UTC, so an ISO string without a
// zone is exactly the same instant.
function wooParam(instant: Date): string {
  return instant.toISOString().slice(0, 19);
}

async function wooRevenue(range: Range): Promise<WooTotals> {
  const url = new URL(`${env.WOO_BASE_URL}/wc-analytics/reports/revenue/stats`);
  url.searchParams.set("after", wooParam(range.from));
  // Woo's `before` is inclusive, so step back one second from our exclusive end.
  url.searchParams.set("before", wooParam(new Date(range.to.getTime() - 1000)));
  url.searchParams.set("interval", "day");

  const response = await fetch(url, { headers: { authorization, accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Woo Analytics ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as { totals: WooTotals };
  return body.totals;
}

function cents(value: number | { toString(): string }): number {
  return Math.round(Number(value.toString()) * 100);
}

type Check = { label: string; woo: number; crm: number };

async function compare(name: string, range: Range): Promise<boolean> {
  const woo = await wooRevenue(range);
  const crm = await revenueTotals(range);

  const checks: Check[] = [
    { label: "orders", woo: woo.orders_count, crm: crm.orders },
    { label: "items sold", woo: woo.num_items_sold, crm: crm.itemsSold },
    { label: "gross sales", woo: cents(woo.gross_sales), crm: cents(crm.grossSales) },
    { label: "coupons", woo: cents(woo.coupons), crm: cents(crm.coupons) },
    { label: "refunds", woo: cents(woo.refunds), crm: cents(crm.refunds) },
    { label: "shipping", woo: cents(woo.shipping), crm: cents(crm.shipping) },
    { label: "taxes", woo: cents(woo.taxes), crm: cents(crm.taxes) },
    { label: "net sales", woo: cents(woo.net_revenue), crm: cents(crm.netSales) },
    { label: "total sales", woo: cents(woo.total_sales), crm: cents(crm.totalSales) },
    { label: "AOV", woo: cents(woo.avg_order_value), crm: cents(crm.averageOrderValue) },
  ];

  const failed = checks.filter((check) => check.woo !== check.crm);

  const window = `${wooParam(range.from)} → ${wooParam(range.to)}`;
  if (failed.length === 0) {
    console.log(`  ✓ ${name.padEnd(22)} ${window}  (${checks.length} measures match)`);
    return true;
  }

  console.log(`  ✗ ${name.padEnd(22)} ${window}`);
  for (const check of failed) {
    console.log(
      `      ${check.label.padEnd(12)} woo=${(check.woo / 100).toFixed(2).padStart(12)}   crm=${(check.crm / 100).toFixed(2).padStart(12)}`,
    );
  }
  return false;
}

/**
 * When a window disagrees, this finds the orders responsible by comparing
 * Woo's own per-order report against the CRM. A total that is off by some
 * amount is not actionable; a list of order ids is.
 */
async function reconcile(range: Range): Promise<void> {
  const wooOrders = new Map<number, { net: number; items: number }>();

  for (let page = 1; ; page += 1) {
    const url = new URL(`${env.WOO_BASE_URL}/wc-analytics/reports/orders`);
    url.searchParams.set("after", wooParam(range.from));
    url.searchParams.set("before", wooParam(new Date(range.to.getTime() - 1000)));
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, { headers: { authorization, accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Woo Analytics ${response.status}: ${await response.text()}`);
    }
    const batch = (await response.json()) as {
      order_id: number;
      net_total: number;
      num_items_sold: number;
    }[];

    for (const order of batch) {
      wooOrders.set(order.order_id, { net: order.net_total, items: order.num_items_sold });
    }
    if (batch.length < 100) break;
  }

  const crmOrders = await prisma.$queryRaw<
    { wooId: number; net: string | number; items: bigint | number }[]
  >`
    SELECT o.wooId AS wooId,
           COALESCE(i.sub, 0) - o.discountTotal AS net,
           COALESCE(i.qty, 0)                   AS items
    FROM \`Order\` o
    LEFT JOIN (
      SELECT orderId, SUM(subtotal) AS sub, SUM(quantity) AS qty
      FROM OrderItem GROUP BY orderId
    ) i ON i.orderId = o.id
    WHERE o.deletedInWoo = 0
      AND o.status NOT IN ('pending', 'failed', 'cancelled')
      AND o.paidAtWoo >= ${range.from}
      AND o.paidAtWoo <  ${range.to}
  `;

  const crmById = new Map(crmOrders.map((row) => [Number(row.wooId), Number(row.net)]));

  const onlyInWoo = [...wooOrders.keys()].filter((id) => !crmById.has(id));
  const onlyInCrm = [...crmById.keys()].filter((id) => !wooOrders.has(id));
  const netDiffers = [...wooOrders.entries()]
    .filter(([id, woo]) => crmById.has(id) && Math.abs(woo.net - crmById.get(id)!) > 0.005)
    .map(([id, woo]) => ({ id, woo: woo.net, crm: crmById.get(id)! }));

  console.log("\n  Per-order reconciliation:");

  for (const id of onlyInWoo) {
    console.log(`    order ${id}: counted by Woo Analytics, absent from the CRM`);
  }
  for (const id of onlyInCrm) {
    console.log(`    order ${id}: in the CRM, not counted by Woo Analytics`);
  }
  for (const row of netDiffers) {
    console.log(
      `    order ${row.id}: net woo=${row.woo.toFixed(2)} crm=${row.crm.toFixed(2)}`,
    );
  }
  if (onlyInWoo.length === 0 && onlyInCrm.length === 0 && netDiffers.length === 0) {
    console.log("    every order agrees on net; the gap is in gross/coupons only.");
  }
}

async function main(): Promise<void> {
  const now = new Date();
  const utc = "UTC";

  // Spec §11 names last calendar month, MTD, and one custom range.
  const today = resolvePeriod("today", utc, now);
  const monthStart = zonedStartOfDay(
    { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: 1 },
    utc,
  );
  const lastMonthStart = zonedStartOfDay(
    { year: now.getUTCFullYear(), month: now.getUTCMonth(), day: 1 },
    utc,
  );

  console.log("Comparing src/lib/metrics against WooCommerce Analytics (UTC)\n");

  const results = [
    await compare("last calendar month", { from: lastMonthStart, to: monthStart }),
    await compare("month to date", { from: monthStart, to: today.to }),
    await compare("custom: August 2026", {
      from: new Date("2026-08-01T00:00:00Z"),
      to: new Date("2026-09-01T00:00:00Z"),
    }),
    await compare("custom: full year", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2027-01-01T00:00:00Z"),
    }),
    await compare("custom: store lifetime", {
      from: new Date("2020-01-01T00:00:00Z"),
      to: today.to,
    }),
  ];

  const failures = results.filter((ok) => !ok).length;

  if (failures > 0) {
    await reconcile({ from: new Date("2026-01-01T00:00:00Z"), to: new Date("2027-01-01T00:00:00Z") });
  }

  console.log("");

  if (failures > 0) {
    throw new Error(
      `${failures} window(s) do not match WooCommerce. That is a bug in src/lib/metrics, not a rounding note.`,
    );
  }
  console.log("All windows match WooCommerce Analytics to the cent.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    await prisma.$disconnect();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
