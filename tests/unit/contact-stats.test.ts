import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { recomputeContactStats } from "@/lib/sync/contacts";
import { resetDatabase } from "./helpers/db";
import { seedContact, seedOrder, seedRefund } from "./helpers/seed";

// recomputeContactStats is the one place denormalised customer figures are
// written (spec §6.1), so its arithmetic is pinned here rather than inferred
// from the dashboard.

beforeEach(async () => {
  await resetDatabase();
});

describe("recomputeContactStats", () => {
  it("counts orders, sums lifetime value, and averages them", async () => {
    const contact = await seedContact("stats@example.com");
    await seedOrder({ contactId: contact.id, paidAt: new Date("2026-01-10T00:00:00Z"), items: [["100.00", 1]] });
    await seedOrder({ contactId: contact.id, paidAt: new Date("2026-02-10T00:00:00Z"), items: [["50.00", 1]] });

    await recomputeContactStats([contact.id]);

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.ordersCount).toBe(2);
    expect(updated.lifetimeValue.toString()).toBe("150");
    expect(updated.avgOrderValue.toString()).toBe("75");
  });

  it("subtracts refunds from lifetime value", async () => {
    const contact = await seedContact("refunded@example.com");
    const order = await seedOrder({
      contactId: contact.id,
      paidAt: new Date("2026-03-01T00:00:00Z"),
      items: [["200.00", 1]],
    });
    await seedRefund(order.id, "50.00", new Date("2026-03-05T00:00:00Z"));
    // refundTotal lives on the order, set by the sync from Woo's own summary.
    await prisma.order.update({ where: { id: order.id }, data: { refundTotal: "50.00" } });

    await recomputeContactStats([contact.id]);

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.lifetimeValue.toString()).toBe("150");
  });

  it("ignores pending, failed and cancelled orders", async () => {
    const contact = await seedContact("excluded@example.com");
    await seedOrder({ contactId: contact.id, paidAt: new Date("2026-01-01T00:00:00Z"), items: [["100.00", 1]] });
    for (const status of ["pending", "failed", "cancelled"]) {
      await seedOrder({ contactId: contact.id, status, paidAt: new Date("2026-01-02T00:00:00Z"), items: [["999.00", 1]] });
    }

    await recomputeContactStats([contact.id]);

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.ordersCount).toBe(1);
    expect(updated.lifetimeValue.toString()).toBe("100");
  });

  it("ignores orders deleted in Woo", async () => {
    const contact = await seedContact("trashed@example.com");
    await seedOrder({ contactId: contact.id, paidAt: new Date("2026-01-01T00:00:00Z"), items: [["100.00", 1]] });
    const trashed = await seedOrder({ contactId: contact.id, paidAt: new Date("2026-01-02T00:00:00Z"), items: [["500.00", 1]] });
    await prisma.order.update({ where: { id: trashed.id }, data: { deletedInWoo: true } });

    await recomputeContactStats([contact.id]);

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.ordersCount).toBe(1);
    expect(updated.lifetimeValue.toString()).toBe("100");
  });

  it("takes first and last order from the created date, not the paid date", async () => {
    // 191 orders in this store have no date_paid at all, so a first/last built
    // on paidAtWoo would leave them blank (Gate 0, C1).
    const contact = await seedContact("dates@example.com");
    await seedOrder({
      contactId: contact.id,
      paidAt: null,
      createdAt: new Date("2026-01-05T00:00:00Z"),
      items: [["10.00", 1]],
    });
    await seedOrder({
      contactId: contact.id,
      paidAt: new Date("2026-06-01T00:00:00Z"),
      createdAt: new Date("2026-06-01T00:00:00Z"),
      items: [["10.00", 1]],
    });

    await recomputeContactStats([contact.id]);

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.firstOrderAt?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect(updated.lastOrderAt?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(updated.ordersCount).toBe(2);
  });

  it("resets a contact whose only order was excluded", async () => {
    const contact = await seedContact("zeroed@example.com");
    const order = await seedOrder({ contactId: contact.id, paidAt: new Date("2026-01-01T00:00:00Z") });
    await recomputeContactStats([contact.id]);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } })).ordersCount).toBe(1);

    await prisma.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
    await recomputeContactStats([contact.id]);

    const updated = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(updated.ordersCount).toBe(0);
    expect(updated.lifetimeValue.toString()).toBe("0");
    expect(updated.avgOrderValue.toString()).toBe("0");
    expect(updated.firstOrderAt).toBeNull();
  });
});
