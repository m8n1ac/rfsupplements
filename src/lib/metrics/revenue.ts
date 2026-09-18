import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Range } from "@/lib/metrics/period";

// The single source for every revenue number (spec §11).
//
// These definitions are WooCommerce's, not the spec's prose, because §11's own
// precedence rule says Woo wins — and because Gate 4 requires matching
// WooCommerce → Analytics to the cent. Every one of them is checked against
// Woo's own Analytics REST API by scripts/verify-metrics.ts.
//
// Verified against /wc-analytics/reports/revenue/stats for August 2026:
//   orders 53 · gross 9135.85 · coupons 7239.63 · shipping 161.76 — exact.

/**
 * Orders Woo counts in Analytics. The default excluded set is pending, failed
 * and cancelled; trash never appears because the sync marks it deletedInWoo.
 *
 * If someone changes woocommerce_excluded_report_order_statuses in wp-admin,
 * verify-metrics.ts stops matching and says so. That is the intended alarm.
 */
export const EXCLUDED_STATUSES = ["pending", "failed", "cancelled"];

/**
 * The date basis. Woo Analytics groups by date_paid on this store, confirmed
 * empirically: on a created-date basis August returns 244 orders against Woo's
 * 53. Reporting therefore uses paidAtWoo throughout, and an order with no
 * payment date is invisible to revenue reporting — which is correct, and is why
 * the 191 unpaid on-hold orders do not distort it.
 */
export const DATE_BASIS = "paidAtWoo" as const;

export type RevenueTotals = {
  orders: number;
  itemsSold: number;
  grossSales: Prisma.Decimal;
  coupons: Prisma.Decimal;
  refunds: Prisma.Decimal;
  netSales: Prisma.Decimal;
  shipping: Prisma.Decimal;
  taxes: Prisma.Decimal;
  totalSales: Prisma.Decimal;
  averageOrderValue: Prisma.Decimal;
  newCustomers: number;
  returningRate: number;
  refundRate: number;
};

const ZERO = new Prisma.Decimal(0);

function decimal(value: unknown): Prisma.Decimal {
  if (value === null || value === undefined) return ZERO;
  return new Prisma.Decimal(String(value));
}

type AggregateRow = {
  orders: bigint | number;
  items: bigint | number | null;
  gross: string | number | null;
  coupons: string | number | null;
  shipping: string | number | null;
  taxes: string | number | null;
};

export async function revenueTotals(range: Range): Promise<RevenueTotals> {
  // Woo derives gross from what was actually charged for the items plus the
  // coupon amounts that reduced it — not from the line subtotals. The two agree
  // whenever every discount came from a coupon, which is the normal case. They
  // diverge on an order discounted without a coupon, where Woo books no gross
  // and no coupon, and summing subtotals would overstate both.
  const [aggregate] = await prisma.$queryRaw<AggregateRow[]>`
    SELECT
      COUNT(*)                                              AS orders,
      COALESCE(SUM(items.quantity), 0)                      AS items,
      COALESCE(SUM(items.total), 0) + COALESCE(SUM(o.couponTotal), 0) AS gross,
      COALESCE(SUM(o.couponTotal), 0)                       AS coupons,
      COALESCE(SUM(o.shippingTotal), 0)                     AS shipping,
      COALESCE(SUM(o.taxTotal), 0)                          AS taxes
    FROM \`Order\` o
    LEFT JOIN (
      SELECT orderId, SUM(quantity) AS quantity, SUM(total) AS total
      FROM OrderItem GROUP BY orderId
    ) items ON items.orderId = o.id
    WHERE o.deletedInWoo = 0
      AND o.status NOT IN (${Prisma.join(EXCLUDED_STATUSES)})
      AND o.paidAtWoo >= ${range.from}
      AND o.paidAtWoo <  ${range.to}
  `;

  // Refunds are counted on the refund's own date, not the order's, so a refund
  // lands in the period it actually happened (spec §11).
  const [refundRow] = await prisma.$queryRaw<{ refunds: string | number | null }[]>`
    SELECT COALESCE(SUM(r.amount), 0) AS refunds
    FROM Refund r
    JOIN \`Order\` o ON o.id = r.orderId
    WHERE r.deletedInWoo = 0
      AND o.deletedInWoo = 0
      AND o.status NOT IN (${Prisma.join(EXCLUDED_STATUSES)})
      AND r.createdAtWoo >= ${range.from}
      AND r.createdAtWoo <  ${range.to}
  `;

  const orders = Number(aggregate?.orders ?? 0);
  const grossSales = decimal(aggregate?.gross);
  const coupons = decimal(aggregate?.coupons);
  const refunds = decimal(refundRow?.refunds);
  const shipping = decimal(aggregate?.shipping);
  const taxes = decimal(aggregate?.taxes);

  const netSales = grossSales.minus(coupons).minus(refunds);
  const totalSales = netSales.plus(shipping).plus(taxes);

  const { newCustomers, returningOrders } = await customerSplit(range);

  return {
    orders,
    itemsSold: Number(aggregate?.items ?? 0),
    grossSales,
    coupons,
    refunds,
    netSales,
    shipping,
    taxes,
    totalSales,
    // Woo's AOV is net revenue over counted orders.
    averageOrderValue: orders > 0 ? netSales.dividedBy(orders) : ZERO,
    newCustomers,
    returningRate: orders > 0 ? returningOrders / orders : 0,
    refundRate: grossSales.greaterThan(0) ? refunds.dividedBy(grossSales).toNumber() : 0,
  };
}

/**
 * A contact is "new" when their first counted order falls inside the period.
 * The returning rate is the share of the period's orders placed by contacts who
 * were not new (spec §11).
 */
async function customerSplit(range: Range): Promise<{ newCustomers: number; returningOrders: number }> {
  const rows = await prisma.$queryRaw<{ contactId: string; firstPaid: Date; ordersInPeriod: bigint }[]>`
    SELECT
      o.contactId                                                   AS contactId,
      MIN(first_order.firstPaid)                                    AS firstPaid,
      COUNT(*)                                                      AS ordersInPeriod
    FROM \`Order\` o
    JOIN (
      SELECT contactId, MIN(paidAtWoo) AS firstPaid
      FROM \`Order\`
      WHERE deletedInWoo = 0
        AND status NOT IN (${Prisma.join(EXCLUDED_STATUSES)})
        AND paidAtWoo IS NOT NULL
        AND contactId IS NOT NULL
      GROUP BY contactId
    ) first_order ON first_order.contactId = o.contactId
    WHERE o.deletedInWoo = 0
      AND o.status NOT IN (${Prisma.join(EXCLUDED_STATUSES)})
      AND o.contactId IS NOT NULL
      AND o.paidAtWoo >= ${range.from}
      AND o.paidAtWoo <  ${range.to}
    GROUP BY o.contactId
  `;

  let newCustomers = 0;
  let returningOrders = 0;

  for (const row of rows) {
    const isNew = row.firstPaid >= range.from && row.firstPaid < range.to;
    if (isNew) {
      newCustomers += 1;
    } else {
      returningOrders += Number(row.ordersInPeriod);
    }
  }

  return { newCustomers, returningOrders };
}

export type SeriesPoint = { day: string; netSales: number; orders: number };

/**
 * Net sales per day, grouped in the given timezone. This is why the MariaDB
 * timezone tables are mandatory: a fixed offset would be wrong for half the
 * year in California (Gate 0, A2).
 */
export async function netSalesSeries(range: Range, timeZone: string): Promise<SeriesPoint[]> {
  const rows = await prisma.$queryRaw<{ day: string; net: string | number; orders: bigint }[]>`
    SELECT
      DATE_FORMAT(CONVERT_TZ(o.paidAtWoo, '+00:00', ${timeZone}), '%Y-%m-%d') AS day,
      COALESCE(SUM(items.total), 0)                                 AS net,
      COUNT(*)                                                      AS orders
    FROM \`Order\` o
    LEFT JOIN (
      SELECT orderId, SUM(total) AS total FROM OrderItem GROUP BY orderId
    ) items ON items.orderId = o.id
    WHERE o.deletedInWoo = 0
      AND o.status NOT IN (${Prisma.join(EXCLUDED_STATUSES)})
      AND o.paidAtWoo >= ${range.from}
      AND o.paidAtWoo <  ${range.to}
    GROUP BY day
    ORDER BY day
  `;

  return rows.map((row) => ({
    day: String(row.day),
    netSales: Number(row.net),
    orders: Number(row.orders),
  }));
}

export type ProductLine = { name: string; sku: string | null; units: number; netSales: number };

export async function topProducts(range: Range, limit = 10): Promise<ProductLine[]> {
  const rows = await prisma.$queryRaw<
    { name: string; sku: string | null; units: bigint; net: string | number }[]
  >`
    SELECT
      oi.name                        AS name,
      MAX(oi.sku)                    AS sku,
      SUM(oi.quantity)               AS units,
      SUM(oi.total)                  AS net
    FROM OrderItem oi
    JOIN \`Order\` o ON o.id = oi.orderId
    WHERE o.deletedInWoo = 0
      AND o.status NOT IN (${Prisma.join(EXCLUDED_STATUSES)})
      AND o.paidAtWoo >= ${range.from}
      AND o.paidAtWoo <  ${range.to}
    GROUP BY oi.name
    ORDER BY net DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    name: row.name,
    sku: row.sku,
    units: Number(row.units),
    netSales: Number(row.net),
  }));
}

export type CouponLine = { code: string; discount: number; orders: number };

export async function topCoupons(range: Range, limit = 10): Promise<CouponLine[]> {
  // Coupon codes live in a JSON column, so they are counted in application code
  // rather than pretending MariaDB can group by a JSON array element.
  const orders = await prisma.order.findMany({
    where: {
      deletedInWoo: false,
      status: { notIn: EXCLUDED_STATUSES },
      paidAtWoo: { gte: range.from, lt: range.to },
    },
    select: { couponCodes: true, couponTotal: true },
  });

  const totals = new Map<string, { discount: number; orders: number }>();

  for (const order of orders) {
    const codes = Array.isArray(order.couponCodes) ? (order.couponCodes as string[]) : [];
    if (codes.length === 0) continue;

    // An order's discount is split evenly when it carries more than one coupon;
    // Woo does not report a per-coupon breakdown on the order.
    const share = Number(order.couponTotal) / codes.length;
    for (const code of codes) {
      const current = totals.get(code) ?? { discount: 0, orders: 0 };
      current.discount += share;
      current.orders += 1;
      totals.set(code, current);
    }
  }

  return [...totals.entries()]
    .map(([code, value]) => ({ code, ...value }))
    .sort((a, b) => b.discount - a.discount)
    .slice(0, limit);
}

export type BreakdownLine = { label: string; value: number; orders: number };

export async function paymentMethodMix(range: Range): Promise<BreakdownLine[]> {
  const rows = await prisma.order.groupBy({
    by: ["paymentMethodTitle"],
    where: {
      deletedInWoo: false,
      status: { notIn: EXCLUDED_STATUSES },
      paidAtWoo: { gte: range.from, lt: range.to },
    },
    _count: { _all: true },
    _sum: { total: true },
  });

  return rows
    .map((row) => ({
      label: row.paymentMethodTitle ?? "unknown",
      value: Number(row._sum.total ?? 0),
      orders: row._count._all,
    }))
    .sort((a, b) => b.value - a.value);
}

export async function ordersByState(range: Range, limit = 10): Promise<BreakdownLine[]> {
  const rows = await prisma.$queryRaw<{ label: string | null; orders: bigint; total: string | number }[]>`
    SELECT
      JSON_UNQUOTE(JSON_EXTRACT(o.billing, '$.state')) AS label,
      COUNT(*)                                         AS orders,
      SUM(o.total)                                     AS total
    FROM \`Order\` o
    WHERE o.deletedInWoo = 0
      AND o.status NOT IN (${Prisma.join(EXCLUDED_STATUSES)})
      AND o.paidAtWoo >= ${range.from}
      AND o.paidAtWoo <  ${range.to}
    GROUP BY label
    ORDER BY orders DESC
    LIMIT ${limit}
  `;

  return rows
    .filter((row) => row.label && row.label.trim())
    .map((row) => ({
      label: String(row.label),
      value: Number(row.total),
      orders: Number(row.orders),
    }));
}

export type CustomerLine = { id: string; email: string; orders: number; lifetimeValue: number };

export async function topCustomers(limit = 20): Promise<CustomerLine[]> {
  const contacts = await prisma.contact.findMany({
    where: { deletedInWoo: false, ordersCount: { gt: 0 } },
    orderBy: { lifetimeValue: "desc" },
    take: limit,
    select: { id: true, email: true, ordersCount: true, lifetimeValue: true },
  });

  return contacts.map((contact) => ({
    id: contact.id,
    email: contact.email,
    orders: contact.ordersCount,
    lifetimeValue: Number(contact.lifetimeValue),
  }));
}
