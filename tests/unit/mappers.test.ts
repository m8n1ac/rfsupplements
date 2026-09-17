import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mapCustomer,
  mapGuestContact,
  mapOrder,
  mapOrderItems,
  mapProduct,
  mapRefund,
  mapVariation,
  normalizeEmail,
} from "@/lib/sync/mappers";
import {
  wooCustomer,
  wooOrder,
  wooProduct,
  wooRefund,
  wooVariation,
} from "@/lib/woo/schemas";

// Fixtures were captured from the live store in Phase 0 and scrubbed of PII
// before entering the repo (spec §13).
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));
}

describe("schema validation", () => {
  it("accepts every Phase 0 fixture", () => {
    expect(() => wooCustomer.parse(fixture("customer"))).not.toThrow();
    expect(() => wooProduct.parse(fixture("product-simple"))).not.toThrow();
    expect(() => wooProduct.parse(fixture("product-variable"))).not.toThrow();
    expect(() => wooVariation.parse(fixture("product-variation"))).not.toThrow();
    expect(() => wooOrder.parse(fixture("order-guest"))).not.toThrow();
    expect(() => wooOrder.parse(fixture("order-coupon"))).not.toThrow();
    expect(() => wooOrder.parse(fixture("order-refunded"))).not.toThrow();
    expect(() => wooRefund.parse(fixture("refund"))).not.toThrow();
  });

  it("reads *_gmt dates as UTC", () => {
    const order = wooOrder.parse(fixture("order-guest"));
    expect(order.date_created_gmt.toISOString()).toBe("2026-09-10T19:08:27.000Z");
    expect(order.date_paid_gmt?.toISOString()).toBe("2026-09-10T19:08:28.000Z");
  });

  it("rejects a record with a malformed money field", () => {
    const broken = { ...(fixture("refund") as object), amount: "not-money" };
    expect(() => wooRefund.parse(broken)).toThrow();
  });
});

describe("mapCustomer", () => {
  it("maps a registered customer", () => {
    const raw = wooCustomer.parse(fixture("customer"));
    const contact = mapCustomer(raw);
    expect(contact.wooCustomerId).toBe(raw.id);
    expect(contact.source).toBe("WOO_CUSTOMER");
    expect(contact.email).toBe(contact.email.toLowerCase());
    expect(contact.deletedInWoo).toBe(false);
  });
});

describe("mapGuestContact", () => {
  it("builds a guest contact from the order's billing block", () => {
    const order = wooOrder.parse(fixture("order-guest"));
    expect(order.customer_id).toBe(0);

    const contact = mapGuestContact(order);
    expect(contact).not.toBeNull();
    expect(contact!.source).toBe("WOO_GUEST");
    expect(contact!.wooCustomerId).toBeNull();
    expect(contact!.email).toBe(normalizeEmail(order.billing.email!));
  });

  it("returns null when the order carries no email to match on", () => {
    const order = wooOrder.parse(fixture("order-guest"));
    expect(mapGuestContact({ ...order, billing: { ...order.billing, email: "" } })).toBeNull();
  });
});

describe("mapProduct", () => {
  it("normalises the in_stock boolean to Woo's stock vocabulary", () => {
    const product = mapProduct(wooProduct.parse(fixture("product-simple")));
    expect(product.stockStatus).toBe("instock");
    expect(product.type).toBe("simple");
    expect(product.parentWooId).toBeNull();
  });

  it("stores an unset sale price as null rather than an empty string", () => {
    const raw = wooProduct.parse(fixture("product-simple"));
    expect(raw.sale_price).toBeNull();
    expect(mapProduct(raw).salePrice).toBeNull();
  });
});

describe("mapVariation", () => {
  const parent = wooProduct.parse(fixture("product-variable"));
  const variation = wooVariation.parse(fixture("product-variation"));

  it("inherits name, status and parent from the parent product", () => {
    const mapped = mapVariation(variation, parent);
    expect(mapped.parentWooId).toBe(parent.id);
    expect(mapped.status).toBe(parent.status);
    expect(mapped.type).toBe("variation");
    expect(mapped.name).toBe("Classic White RF T-shirt - S");
  });

  it("carries the variation's own stock state, not the parent's", () => {
    expect(variation.in_stock).toBe(false);
    expect(mapVariation(variation, parent).stockStatus).toBe("outofstock");
  });
});

describe("mapOrder", () => {
  it("maps a guest order and keeps money as exact decimal strings", () => {
    const order = wooOrder.parse(fixture("order-guest"));
    const mapped = mapOrder(order, null);

    expect(mapped.wooId).toBe(order.id);
    expect(mapped.contactId).toBeNull();
    expect(mapped.total).toBe("45.99");
    expect(typeof mapped.total).toBe("string");
    expect(mapped.status).toBe("completed");
  });

  it("sums the subtotal from line items", () => {
    const order = wooOrder.parse(fixture("order-guest"));
    const expected = order.line_items
      .reduce((sum, item) => sum + Number(item.subtotal), 0)
      .toFixed(2);
    expect(mapOrder(order, null).subtotal).toBe(expected);
  });

  it("extracts coupon codes", () => {
    const order = wooOrder.parse(fixture("order-coupon"));
    expect(mapOrder(order, null).couponCodes).toEqual(["roo100"]);
  });

  it("keeps paidAtWoo, which is the reporting basis", () => {
    const order = wooOrder.parse(fixture("order-guest"));
    expect(mapOrder(order, null).paidAtWoo).toEqual(order.date_paid_gmt);
  });
});

describe("mapOrderItems", () => {
  it("maps line items and nulls the zero product/variation ids", () => {
    const order = wooOrder.parse(fixture("order-guest"));
    const items = mapOrderItems(order, "order-1");

    expect(items).toHaveLength(order.line_items.length);
    expect(items[0].orderId).toBe("order-1");
    expect(items[0].wooLineItemId).toBe(order.line_items[0].id);
    for (const item of items) {
      expect(item.productWooId).not.toBe(0);
      expect(item.variationWooId).not.toBe(0);
    }
  });
});

describe("mapRefund", () => {
  it("maps a refund against its order", () => {
    const refund = mapRefund(wooRefund.parse(fixture("refund")), "order-1");
    expect(refund.orderId).toBe("order-1");
    expect(refund.amount).toBe("46.15");
    expect(refund.reason).toBeNull();
  });
});
