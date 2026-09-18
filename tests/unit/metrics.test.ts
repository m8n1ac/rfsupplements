import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  netSalesSeries,
  ordersByState,
  revenueTotals,
  topCoupons,
  topProducts,
} from "@/lib/metrics/revenue";
import { resolvePeriod, priorPeriod, zonedStartOfDay } from "@/lib/metrics/period";
import { resetDatabase } from "./helpers/db";
import { seedContact, seedOrder, seedRefund } from "./helpers/seed";

// Every figure below is computed on paper first, so a regression shows up as a
// wrong number rather than a differently-wrong number (spec §13).
//
// The scenario, all inside March 2026 UTC:
//
//   order A  paid Mar 2   items 100.00 + 50.00 = 150.00   discount 25.00
//                         shipping 10.00  tax 5.00
//   order B  paid Mar 10  items 200.00                     discount  0.00
//                         shipping  0.00  tax 0.00
//   order C  paid Mar 20  items  80.00                     refunded 30.00 on Mar 22
//   order D  status failed, paid Mar 15, items 999.00      -> excluded
//   order E  never paid,             items 500.00          -> invisible to revenue
//
//   gross   = 150 + 200 + 80            = 430.00
//   coupons = 25                        =  25.00
//   refunds = 30 (on its own date)      =  30.00
//   net     = 430 - 25 - 30             = 375.00
//   total   = 375 + shipping 10 + tax 5 = 390.00
//   orders  = 3          AOV = 375 / 3  = 125.00
//   items   = 2 + 1 + 1                 = 4

const MARCH = {
  from: new Date("2026-03-01T00:00:00Z"),
  to: new Date("2026-04-01T00:00:00Z"),
};

async function seedScenario() {
  const alice = await seedContact("alice@example.com");
  const bob = await seedContact("bob@example.com");

  await seedOrder({
    contactId: alice.id,
    paidAt: new Date("2026-03-02T12:00:00Z"),
    items: [["100.00", 1], ["50.00", 1]],
    discount: "25.00",
    shipping: "10.00",
    tax: "5.00",
  });
  await seedOrder({
    contactId: bob.id,
    paidAt: new Date("2026-03-10T12:00:00Z"),
    items: [["200.00", 1]],
  });
  const orderC = await seedOrder({
    contactId: alice.id,
    paidAt: new Date("2026-03-20T12:00:00Z"),
    items: [["80.00", 1]],
  });
  await seedRefund(orderC.id, "30.00", new Date("2026-03-22T12:00:00Z"));

  await seedOrder({
    contactId: bob.id,
    status: "failed",
    paidAt: new Date("2026-03-15T12:00:00Z"),
    items: [["999.00", 1]],
  });
  await seedOrder({
    contactId: bob.id,
    paidAt: null,
    createdAt: new Date("2026-03-18T12:00:00Z"),
    items: [["500.00", 1]],
  });

  return { alice, bob };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("revenueTotals", () => {
  it("matches the hand-computed figures exactly", async () => {
    await seedScenario();
    const totals = await revenueTotals(MARCH);

    expect(totals.orders).toBe(3);
    expect(totals.itemsSold).toBe(4);
    expect(totals.grossSales.toFixed(2)).toBe("430.00");
    expect(totals.coupons.toFixed(2)).toBe("25.00");
    expect(totals.refunds.toFixed(2)).toBe("30.00");
    expect(totals.netSales.toFixed(2)).toBe("375.00");
    expect(totals.shipping.toFixed(2)).toBe("10.00");
    expect(totals.taxes.toFixed(2)).toBe("5.00");
    expect(totals.totalSales.toFixed(2)).toBe("390.00");
    expect(totals.averageOrderValue.toFixed(2)).toBe("125.00");
  });

  it("reports a refund in the period it happened, not the order's", async () => {
    const contact = await seedContact("late-refund@example.com");
    const order = await seedOrder({
      contactId: contact.id,
      paidAt: new Date("2026-03-20T12:00:00Z"),
      items: [["80.00", 1]],
    });
    // Refunded in April, for a March order.
    await seedRefund(order.id, "30.00", new Date("2026-04-05T12:00:00Z"));

    const march = await revenueTotals(MARCH);
    expect(march.refunds.toFixed(2)).toBe("0.00");
    expect(march.netSales.toFixed(2)).toBe("80.00");

    const april = await revenueTotals({
      from: new Date("2026-04-01T00:00:00Z"),
      to: new Date("2026-05-01T00:00:00Z"),
    });
    expect(april.refunds.toFixed(2)).toBe("30.00");
  });

  it("is empty for a period with nothing in it", async () => {
    await seedScenario();
    const totals = await revenueTotals({
      from: new Date("2025-01-01T00:00:00Z"),
      to: new Date("2025-02-01T00:00:00Z"),
    });

    expect(totals.orders).toBe(0);
    expect(totals.netSales.toFixed(2)).toBe("0.00");
    // No orders means no average, not a division by zero.
    expect(totals.averageOrderValue.toFixed(2)).toBe("0.00");
    expect(totals.refundRate).toBe(0);
  });

  it("counts a customer as new only when their first paid order is in the period", async () => {
    const returning = await seedContact("returning@example.com");
    // First ever order, well before the window.
    await seedOrder({ contactId: returning.id, paidAt: new Date("2026-01-05T12:00:00Z"), items: [["10.00", 1]] });
    await seedOrder({ contactId: returning.id, paidAt: new Date("2026-03-05T12:00:00Z"), items: [["10.00", 1]] });

    const brandNew = await seedContact("brand-new@example.com");
    await seedOrder({ contactId: brandNew.id, paidAt: new Date("2026-03-06T12:00:00Z"), items: [["10.00", 1]] });

    const totals = await revenueTotals(MARCH);

    expect(totals.orders).toBe(2);
    expect(totals.newCustomers).toBe(1);
    // One of the period's two orders came from a contact who was not new.
    expect(totals.returningRate).toBeCloseTo(0.5, 5);
  });

  it("books no gross for a discount that has no coupon behind it", async () => {
    // Order 2403 in the live store: $5,000 off with no coupon attached.
    // WooCommerce derives gross from what was charged plus coupon amounts, so
    // it books this as gross 0 and coupons 0. Summing line subtotals instead
    // would overstate both by $5,000 — which is exactly what the CRM did until
    // 2026-09-18.
    const contact = await seedContact("uncouponed@example.com");
    const order = await seedOrder({
      contactId: contact.id,
      paidAt: new Date("2026-03-11T12:00:00Z"),
      items: [["2500.00", 10], ["2500.00", 10]],
    });
    // Discounted to nothing, with no coupon: line totals 0, couponTotal 0.
    await prisma.orderItem.updateMany({ where: { orderId: order.id }, data: { total: "0.00" } });
    await prisma.order.update({
      where: { id: order.id },
      data: { discountTotal: "5000.00", couponTotal: "0.00", total: "0.00" },
    });

    const totals = await revenueTotals(MARCH);

    expect(totals.grossSales.toFixed(2)).toBe("0.00");
    expect(totals.coupons.toFixed(2)).toBe("0.00");
    expect(totals.netSales.toFixed(2)).toBe("0.00");
    // It still counts as an order, which is what moves AOV.
    expect(totals.orders).toBe(1);
  });

  it("computes the refund rate against gross sales", async () => {
    await seedScenario();
    const totals = await revenueTotals(MARCH);
    // 30 / 430
    expect(totals.refundRate).toBeCloseTo(30 / 430, 6);
  });
});

describe("netSalesSeries", () => {
  it("groups by day in the requested timezone", async () => {
    const contact = await seedContact("tz@example.com");
    // 03:00 UTC on Mar 3 is still Mar 2 in Los Angeles (UTC-8).
    await seedOrder({
      contactId: contact.id,
      paidAt: new Date("2026-03-03T03:00:00Z"),
      items: [["100.00", 1]],
    });

    const utc = await netSalesSeries(MARCH, "UTC");
    expect(utc[0].day).toBe("2026-03-03");

    const pacific = await netSalesSeries(MARCH, "America/Los_Angeles");
    expect(pacific[0].day).toBe("2026-03-02");
  });

  it("nets each day's discounts off that day's gross", async () => {
    await seedScenario();
    const series = await netSalesSeries(MARCH, "UTC");

    const byDay = Object.fromEntries(series.map((point) => [point.day, point.netSales]));
    expect(byDay["2026-03-02"]).toBeCloseTo(125, 2); // 150 - 25
    expect(byDay["2026-03-10"]).toBeCloseTo(200, 2);
    expect(byDay["2026-03-20"]).toBeCloseTo(80, 2);  // refund lands on the 22nd
  });
});

describe("breakdowns", () => {
  it("ranks products by net sales", async () => {
    await seedScenario();
    const products = await topProducts(MARCH);
    expect(products[0].netSales).toBeGreaterThanOrEqual(products[1]?.netSales ?? 0);
    expect(products.reduce((sum, row) => sum + row.units, 0)).toBe(4);
  });

  it("splits an order's discount evenly across its coupons", async () => {
    const contact = await seedContact("coupons@example.com");
    const order = await seedOrder({
      contactId: contact.id,
      paidAt: new Date("2026-03-04T12:00:00Z"),
      items: [["100.00", 1]],
      discount: "30.00",
    });
    await prisma.order.update({
      where: { id: order.id },
      data: { couponCodes: ["SAVE10", "EXTRA20"] },
    });

    const coupons = await topCoupons(MARCH);
    expect(coupons).toHaveLength(2);
    for (const coupon of coupons) {
      expect(coupon.discount).toBeCloseTo(15, 5);
      expect(coupon.orders).toBe(1);
    }
  });

  it("omits orders with no billing state", async () => {
    await seedScenario();
    // The seeded orders carry no billing block at all.
    expect(await ordersByState(MARCH)).toEqual([]);
  });
});

describe("period resolution", () => {
  const now = new Date("2026-03-15T18:00:00Z");

  it("builds month-to-date from local midnight on the first", () => {
    const period = resolvePeriod("mtd", "America/Los_Angeles", now);
    // 1 March 00:00 Pacific is 08:00 UTC — PST, before the DST change.
    expect(period.from.toISOString()).toBe("2026-03-01T08:00:00.000Z");
  });

  it("handles the spring DST change without drifting an hour", () => {
    // US DST began 8 March 2026. A window spanning it must still start and end
    // on local midnight, at different UTC offsets.
    const before = zonedStartOfDay({ year: 2026, month: 3, day: 7 }, "America/Los_Angeles");
    const after = zonedStartOfDay({ year: 2026, month: 3, day: 9 }, "America/Los_Angeles");

    expect(before.toISOString()).toBe("2026-03-07T08:00:00.000Z"); // PST, UTC-8
    expect(after.toISOString()).toBe("2026-03-09T07:00:00.000Z");  // PDT, UTC-7
  });

  it("gives the prior period the same length, ending where this one starts", () => {
    const period = resolvePeriod("30d", "UTC", now);
    const prior = priorPeriod(period);

    expect(prior.to.getTime()).toBe(period.from.getTime());
    expect(prior.to.getTime() - prior.from.getTime()).toBe(
      period.to.getTime() - period.from.getTime(),
    );
  });

  it("treats a custom range's end date as the whole day", () => {
    const period = resolvePeriod("custom", "UTC", now, { from: "2026-03-01", to: "2026-03-31" });
    expect(period.from.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(period.to.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
});
