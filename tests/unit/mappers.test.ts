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
    const raw = fixture("order-guest") as { date_created_gmt: string };
    const order = wooOrder.parse(raw);
    // The zoneless Woo string is UTC, so it round-trips with a Z appended.
    expect(order.date_created_gmt.toISOString()).toBe(`${raw.date_created_gmt}.000Z`);
    expect(order.date_created_gmt.getTime()).not.toBeNaN();
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
  it("carries Woo's stock_status through unchanged", () => {
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
  const variation = wooVariation.parse(fixture("product-variation"));
  // The captured variation belongs to product 1668, so the parent is fetched by
  // id rather than assumed to be the product-variable fixture.
  const parent = wooProduct.parse(fixture("product-parent"));

  it("composes the full name from the parent, since Woo sends only the option", () => {
    expect(variation.name).toBe("Green Apple");
    const mapped = mapVariation(variation, parent);
    expect(mapped.name).toBe(`${parent.name} - Green Apple`);
    expect(mapped.type).toBe("variation");
  });

  it("takes status, parent and stock from the variation itself", () => {
    const mapped = mapVariation(variation, parent);
    expect(mapped.parentWooId).toBe(variation.parent_id);
    expect(mapped.status).toBe(variation.status);
    expect(mapped.stockStatus).toBe(variation.stock_status);
  });
});

describe("mapOrder", () => {
  it("maps a guest order and keeps money as exact decimal strings", () => {
    const order = wooOrder.parse(fixture("order-guest"));
    const mapped = mapOrder(order, null);

    expect(mapped.wooId).toBe(order.id);
    expect(mapped.contactId).toBeNull();
    // Passed through verbatim: no float ever touches it.
    expect(mapped.total).toBe(order.total);
    expect(typeof mapped.total).toBe("string");
    expect(mapped.total).toMatch(/^-?\d+\.\d{2}$/);
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
    expect(order.coupon_lines.length).toBeGreaterThan(0);
    expect(mapOrder(order, null).couponCodes).toEqual(
      order.coupon_lines.map((line) => line.code),
    );
  });

  it("takes refundTotal from the order's own refund summary, as a positive amount", () => {
    const refunded = wooOrder.parse(fixture("order-refunded"));
    expect(refunded.refunds.length).toBeGreaterThan(0);
    // Woo reports it negative; the order stores the magnitude.
    expect(Number(refunded.refunds[0].total)).toBeLessThan(0);
    const expected = refunded.refunds
      .reduce((sum, refund) => sum + Math.abs(Number(refund.total)), 0)
      .toFixed(2);
    expect(mapOrder(refunded, null).refundTotal).toBe(expected);
    expect(Number(expected)).toBeGreaterThan(0);
  });

  it("reports no refund total for an order with none", () => {
    const plain = wooOrder.parse(fixture("order-guest"));
    expect(plain.refunds).toEqual([]);
    expect(mapOrder(plain, null).refundTotal).toBe("0.00");
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

describe("shipment tracking", () => {
  it("lifts tracking out of Woo's meta_data", () => {
    const order = wooOrder.parse({
      ...(fixture("order-guest") as object),
      meta_data: [
        { id: 1, key: "_unrelated", value: "x" },
        {
          id: 2,
          key: "_wc_shipment_tracking_items",
          value: [
            {
              tracking_number: "9400111899223197428490",
              custom_tracking_provider: "USPS - Ground Advantage",
              custom_tracking_link: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490",
            },
          ],
        },
      ],
    });

    const mapped = mapOrder(order, null);
    const tracking = mapped.tracking as { tracking_number: string }[];

    expect(tracking).toHaveLength(1);
    expect(tracking[0].tracking_number).toBe("9400111899223197428490");
  });

  it("is an empty list for an order that has not shipped", () => {
    const order = wooOrder.parse({ ...(fixture("order-guest") as object), meta_data: [] });
    expect(mapOrder(order, null).tracking).toEqual([]);
  });
});
