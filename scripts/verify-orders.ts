// Gate 2: re-reads N random orders from Woo and compares them field by field
// against what the CRM stored.
//
//   npm run verify:orders -- --count=20
//
// It compares the mapped shape, not the raw payload: the point is that the
// mapping is faithful, not that two JSON blobs are byte-identical.
import "dotenv/config";

import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import { wooOrder } from "../src/lib/woo/schemas";
import { mapOrder } from "../src/lib/sync/mappers";

const authorization = `Basic ${Buffer.from(
  `${env.WOO_USER}:${env.WOO_APP_PASSWORD}`,
).toString("base64")}`;

type Mismatch = { wooId: number; field: string; woo: string; crm: string };

// Money crosses the boundary as a decimal string from Woo and as a Prisma
// Decimal from the database. They are equal when their values are equal, not
// when their text matches, so money is compared at a fixed 2 places.
const MONEY_FIELDS = new Set([
  "total",
  "subtotal",
  "discountTotal",
  "shippingTotal",
  "taxTotal",
  "refundTotal",
]);

function money(value: unknown): string {
  return Number(String(value)).toFixed(2);
}

function show(field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (MONEY_FIELDS.has(field)) return money(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function main(): Promise<void> {
  const count = Number(
    process.argv.find((arg) => arg.startsWith("--count="))?.split("=")[1] ?? "20",
  );

  const sample = await prisma.$queryRawUnsafe<{ wooId: number }[]>(
    `SELECT wooId FROM \`Order\` ORDER BY RAND() LIMIT ${Number(count)}`,
  );

  const mismatches: Mismatch[] = [];

  for (const { wooId } of sample) {
    const response = await fetch(`${env.WOO_BASE_URL}/wc/v3/orders/${wooId}`, {
      headers: { authorization, accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Woo ${response.status} for order ${wooId}`);
    }

    const live = mapOrder(wooOrder.parse(await response.json()), null);
    const stored = await prisma.order.findUniqueOrThrow({ where: { wooId } });

    const fields = [
      "number",
      "status",
      "currency",
      "total",
      "subtotal",
      "discountTotal",
      "shippingTotal",
      "taxTotal",
      "refundTotal",
      "paymentMethod",
      "paymentMethodTitle",
      "createdAtWoo",
      "paidAtWoo",
      "completedAtWoo",
    ] as const;

    for (const field of fields) {
      const fromWoo = show(field, live[field]);
      const fromCrm = show(field, stored[field]);
      if (fromWoo !== fromCrm) {
        mismatches.push({ wooId, field, woo: fromWoo, crm: fromCrm });
      }
    }

    // Line items are compared as a set of (lineItemId, sku, qty, total).
    const liveItems = live && wooOrder.parse(await refetch(wooId)).line_items;
    const storedItems = await prisma.orderItem.findMany({
      where: { orderId: stored.id },
      orderBy: { wooLineItemId: "asc" },
    });

    const liveKey = liveItems
      .map((item) => `${item.id}:${item.sku ?? ""}:${item.quantity}:${money(item.total)}`)
      .sort()
      .join("|");
    const crmKey = storedItems
      .map(
        (item) =>
          `${item.wooLineItemId}:${item.sku ?? ""}:${item.quantity}:${money(item.total)}`,
      )
      .sort()
      .join("|");

    if (liveKey !== crmKey) {
      mismatches.push({ wooId, field: "line_items", woo: liveKey, crm: crmKey });
    }
  }

  console.log(`Compared ${sample.length} orders, ${15} fields each (14 scalar + line items).`);

  if (mismatches.length === 0) {
    console.log("RESULT: all fields match.");
    return;
  }

  console.log(`RESULT: ${mismatches.length} mismatches`);
  for (const mismatch of mismatches) {
    console.log(`  order ${mismatch.wooId} · ${mismatch.field}`);
    console.log(`    woo: ${mismatch.woo}`);
    console.log(`    crm: ${mismatch.crm}`);
  }
  process.exitCode = 1;
}

async function refetch(wooId: number): Promise<unknown> {
  const response = await fetch(`${env.WOO_BASE_URL}/wc/v3/orders/${wooId}`, {
    headers: { authorization, accept: "application/json" },
  });
  return response.json();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    await prisma.$disconnect();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
