import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { mapCustomer, mapGuestContact } from "@/lib/sync/mappers";
import type { WooCustomer, WooOrder } from "@/lib/woo/schemas";

// Contact matching (spec §6.1): match on wooCustomerId when it is present,
// otherwise on the lowercase-trimmed email. There is never a second contact for
// the same email.

// Orders in these states never count toward a customer's history. This is
// WooCommerce's own default exclusion list, confirmed in Phase 0.
export const NON_COUNTING_STATUSES = ["pending", "failed", "cancelled", "trash"];

export async function upsertCustomerContact(customer: WooCustomer): Promise<string> {
  const data = mapCustomer(customer);

  const existing =
    (await prisma.contact.findUnique({ where: { wooCustomerId: customer.id } })) ??
    (await prisma.contact.findUnique({ where: { email: data.email } }));

  if (!existing) {
    const created = await prisma.contact.create({ data });
    return created.id;
  }

  // A guest who has since registered: keep the contact, attach the Woo id and
  // promote the source.
  const updated = await prisma.contact.update({
    where: { id: existing.id },
    data: { ...data, source: "WOO_CUSTOMER" },
  });
  return updated.id;
}

// Returns null when the order carries no email at all, which leaves the order
// unattached rather than inventing a contact.
export async function upsertGuestContact(order: WooOrder): Promise<string | null> {
  const data = mapGuestContact(order);
  if (!data) {
    return null;
  }

  const existing = await prisma.contact.findUnique({ where: { email: data.email } });

  if (!existing) {
    const created = await prisma.contact.create({ data });
    return created.id;
  }

  // Never downgrade a registered contact to WOO_GUEST, and never overwrite
  // details Woo already holds for them with the ones typed at checkout.
  if (existing.source === "WOO_CUSTOMER") {
    return existing.id;
  }

  const updated = await prisma.contact.update({
    where: { id: existing.id },
    data: {
      firstName: existing.firstName ?? data.firstName,
      lastName: existing.lastName ?? data.lastName,
      phone: existing.phone ?? data.phone,
      billing: data.billing as Prisma.InputJsonValue,
      shipping: data.shipping as Prisma.InputJsonValue,
      syncedAt: new Date(),
    },
  });
  return updated.id;
}

// Resolves the contact for an order, registered or guest.
export async function contactForOrder(order: WooOrder): Promise<string | null> {
  if (order.customer_id === 0) {
    return upsertGuestContact(order);
  }

  const registered = await prisma.contact.findUnique({
    where: { wooCustomerId: order.customer_id },
  });

  // The customers step runs before orders, so this is normally a hit. If the
  // customer has not been seen yet, fall back to the order's own email so the
  // order is never orphaned; the customers step will attach the Woo id later.
  return registered?.id ?? upsertGuestContact(order);
}

// Recomputes the denormalised stats for every contact touched in a run
// (spec §6.1). One function, called from one place per resource.
//
// firstOrderAt/lastOrderAt use createdAtWoo, not paidAtWoo: they answer "when
// did this person order", and 191 orders in this store have no date_paid at
// all. paidAtWoo is reserved for revenue reporting (Gate 0, C1).
export async function recomputeContactStats(contactIds: string[]): Promise<void> {
  const unique = [...new Set(contactIds)];

  for (const contactId of unique) {
    const aggregate = await prisma.order.aggregate({
      where: {
        contactId,
        deletedInWoo: false,
        status: { notIn: NON_COUNTING_STATUSES },
      },
      _count: { _all: true },
      _sum: { total: true, refundTotal: true },
      _min: { createdAtWoo: true },
      _max: { createdAtWoo: true },
    });

    const ordersCount = aggregate._count._all;
    const gross = aggregate._sum.total ?? new Prisma.Decimal(0);
    const refunded = aggregate._sum.refundTotal ?? new Prisma.Decimal(0);
    const lifetimeValue = gross.minus(refunded);

    await prisma.contact.update({
      where: { id: contactId },
      data: {
        ordersCount,
        lifetimeValue,
        avgOrderValue:
          ordersCount > 0 ? lifetimeValue.dividedBy(ordersCount).toDecimalPlaces(2) : 0,
        firstOrderAt: aggregate._min.createdAtWoo,
        lastOrderAt: aggregate._max.createdAtWoo,
      },
    });
  }
}
