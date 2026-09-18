import { prisma } from "@/lib/db";

// Hand-built rows with values chosen so every expected figure can be computed on
// paper. Nothing here comes from the live store.

export async function seedContact(email: string, wooCustomerId: number | null = null) {
  return prisma.contact.create({
    data: { email, source: wooCustomerId ? "WOO_CUSTOMER" : "WOO_GUEST", wooCustomerId },
  });
}

let nextWooId = 9000;

export type SeedOrder = {
  contactId: string | null;
  status?: string;
  /** Instant the order was paid; null means never paid, so it is invisible to revenue. */
  paidAt: Date | null;
  createdAt?: Date;
  /** Line items as [unitSubtotal, quantity] pairs. */
  items?: [string, number][];
  discount?: string;
  shipping?: string;
  tax?: string;
};

export async function seedOrder(order: SeedOrder) {
  const items = order.items ?? [["100.00", 1]];
  const gross = items.reduce((sum, [subtotal]) => sum + Number(subtotal), 0);
  const discount = order.discount ?? "0.00";
  const wooId = nextWooId++;

  const created = await prisma.order.create({
    data: {
      wooId,
      number: String(wooId),
      contactId: order.contactId,
      status: order.status ?? "completed",
      currency: "USD",
      total: (gross - Number(discount) + Number(order.shipping ?? "0")).toFixed(2),
      subtotal: gross.toFixed(2),
      discountTotal: discount,
      shippingTotal: order.shipping ?? "0.00",
      taxTotal: order.tax ?? "0.00",
      createdAtWoo: order.createdAt ?? order.paidAt ?? new Date(),
      paidAtWoo: order.paidAt,
      modifiedAtWoo: order.paidAt,
    },
  });

  await prisma.orderItem.createMany({
    data: items.map(([subtotal, quantity], index) => ({
      orderId: created.id,
      wooLineItemId: index + 1,
      name: `Item ${index + 1}`,
      quantity,
      subtotal,
      total: subtotal,
    })),
  });

  return created;
}

export async function seedRefund(orderId: string, amount: string, createdAt: Date) {
  return prisma.refund.create({
    data: { wooId: nextWooId++, orderId, amount, reason: null, createdAtWoo: createdAt },
  });
}
