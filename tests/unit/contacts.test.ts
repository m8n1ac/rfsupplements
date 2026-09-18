import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { wooCustomer, wooOrder } from "@/lib/woo/schemas";
import {
  contactForOrder,
  upsertCustomerContact,
  upsertGuestContact,
} from "@/lib/sync/contacts";
import { resetDatabase } from "./helpers/db";

// Contact matching is the heaviest-risk path in the sync: this store is
// overwhelmingly guest-driven (523 of 573 orders at Phase 0), and 12 emails
// appear as both a guest and a registered customer.

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

function guestOrder(overrides: Record<string, unknown> = {}) {
  return wooOrder.parse({ ...fixture("order-guest"), customer_id: 0, ...overrides });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("upsertGuestContact", () => {
  it("creates a guest contact from the order's billing block", async () => {
    const order = guestOrder();
    const id = await upsertGuestContact(order);

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: id! } });
    expect(contact.source).toBe("WOO_GUEST");
    expect(contact.wooCustomerId).toBeNull();
    expect(contact.email).toBe(order.billing.email!.toLowerCase());
  });

  it("never creates a second contact for the same email", async () => {
    const first = await upsertGuestContact(guestOrder());
    const second = await upsertGuestContact(
      guestOrder({ billing: { ...fixture("order-guest").billing as object, email: "GUEST@Example.COM" } }),
    );
    const third = await upsertGuestContact(
      guestOrder({ billing: { ...fixture("order-guest").billing as object, email: "guest@example.com" } }),
    );

    expect(second).toBe(third);
    expect(await prisma.contact.count()).toBe(2);
    expect(first).not.toBe(second);
  });

  it("matches on email regardless of case or surrounding space", async () => {
    const billing = fixture("order-guest").billing as Record<string, unknown>;
    const a = await upsertGuestContact(guestOrder({ billing: { ...billing, email: "  Mixed.Case@Example.com " } }));
    const b = await upsertGuestContact(guestOrder({ billing: { ...billing, email: "mixed.case@example.com" } }));

    expect(a).toBe(b);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("leaves the order unattached when it carries no email at all", async () => {
    const billing = fixture("order-guest").billing as Record<string, unknown>;
    const id = await upsertGuestContact(guestOrder({ billing: { ...billing, email: "" } }));

    expect(id).toBeNull();
    expect(await prisma.contact.count()).toBe(0);
  });
});

describe("guest who later registers", () => {
  it("keeps the existing contact and attaches the Woo customer id", async () => {
    const billing = fixture("order-guest").billing as Record<string, unknown>;
    const shared = "returning@example.com";

    const guestId = await upsertGuestContact(guestOrder({ billing: { ...billing, email: shared } }));

    const registered = wooCustomer.parse({ ...fixture("customer"), id: 4242, email: shared });
    const registeredId = await upsertCustomerContact(registered);

    // The same row, promoted — not a duplicate.
    expect(registeredId).toBe(guestId);
    expect(await prisma.contact.count()).toBe(1);

    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: registeredId } });
    expect(contact.wooCustomerId).toBe(4242);
    expect(contact.source).toBe("WOO_CUSTOMER");
  });

  it("does not downgrade a registered contact back to guest", async () => {
    const shared = "already-registered@example.com";
    const registered = wooCustomer.parse({ ...fixture("customer"), id: 77, email: shared });
    const registeredId = await upsertCustomerContact(registered);

    const billing = fixture("order-guest").billing as Record<string, unknown>;
    const guestId = await upsertGuestContact(guestOrder({ billing: { ...billing, email: shared } }));

    expect(guestId).toBe(registeredId);
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: registeredId } });
    expect(contact.source).toBe("WOO_CUSTOMER");
    expect(contact.wooCustomerId).toBe(77);
  });
});

describe("contactForOrder", () => {
  it("uses the Woo customer id when the order has one", async () => {
    const customer = wooCustomer.parse({ ...fixture("customer"), id: 500, email: "registered@example.com" });
    const expected = await upsertCustomerContact(customer);

    const billing = fixture("order-guest").billing as Record<string, unknown>;
    const order = wooOrder.parse({
      ...fixture("order-guest"),
      customer_id: 500,
      // A different email on the order must not win over the customer id.
      billing: { ...billing, email: "typo-at-checkout@example.com" },
    });

    expect(await contactForOrder(order)).toBe(expected);
    expect(await prisma.contact.count()).toBe(1);
  });

  it("falls back to the order's email when the customer has not synced yet", async () => {
    const billing = fixture("order-guest").billing as Record<string, unknown>;
    const order = wooOrder.parse({
      ...fixture("order-guest"),
      customer_id: 999,
      billing: { ...billing, email: "not-yet-synced@example.com" },
    });

    const id = await contactForOrder(order);
    const contact = await prisma.contact.findUniqueOrThrow({ where: { id: id! } });

    // Attached rather than orphaned; the customers step attaches the Woo id later.
    expect(contact.email).toBe("not-yet-synced@example.com");
    expect(contact.wooCustomerId).toBeNull();
  });
});
