import type { Prisma } from "@/generated/prisma/client";
import type {
  WooCustomer,
  WooOrder,
  WooProduct,
  WooRefund,
  WooVariation,
} from "@/lib/woo/schemas";

// Pure Woo -> Prisma translation. No database access and no I/O, so these are
// unit-testable against the Phase 0 fixtures (spec §13).

// Woo sends "" for an unset address field; store null rather than empty string.
function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function mapCustomer(customer: WooCustomer): Prisma.ContactUncheckedCreateInput {
  return {
    wooCustomerId: customer.id,
    email: normalizeEmail(customer.email),
    firstName: blankToNull(customer.first_name),
    lastName: blankToNull(customer.last_name),
    phone: blankToNull(customer.billing.phone),
    company: blankToNull(customer.billing.company),
    billing: customer.billing as Prisma.InputJsonValue,
    shipping: customer.shipping as Prisma.InputJsonValue,
    source: "WOO_CUSTOMER",
    modifiedAtWoo: customer.date_modified_gmt ?? customer.date_created_gmt,
    deletedInWoo: false,
    syncedAt: new Date(),
    raw: customer as unknown as Prisma.InputJsonValue,
  };
}

// A guest buyer has customer_id 0, so the order's billing block is the only
// identity we get (spec §6.1, contact matching).
export function mapGuestContact(order: WooOrder): Prisma.ContactUncheckedCreateInput | null {
  const email = order.billing.email ? normalizeEmail(order.billing.email) : "";
  if (!email) {
    return null;
  }

  return {
    wooCustomerId: null,
    email,
    firstName: blankToNull(order.billing.first_name),
    lastName: blankToNull(order.billing.last_name),
    phone: blankToNull(order.billing.phone),
    company: blankToNull(order.billing.company),
    billing: order.billing as Prisma.InputJsonValue,
    shipping: order.shipping as Prisma.InputJsonValue,
    source: "WOO_GUEST",
    syncedAt: new Date(),
  };
}

export function mapProduct(product: WooProduct): Prisma.ProductUncheckedCreateInput {
  return {
    wooId: product.id,
    parentWooId: product.parent_id === 0 ? null : product.parent_id,
    sku: blankToNull(product.sku),
    name: product.name,
    type: product.type,
    status: product.status,
    price: product.price,
    regularPrice: product.regular_price,
    salePrice: product.sale_price,
    stockStatus: product.stock_status,
    stockQuantity: product.stock_quantity,
    categories: product.categories as unknown as Prisma.InputJsonValue,
    modifiedAtWoo: product.date_modified_gmt ?? product.date_created_gmt,
    deletedInWoo: false,
    syncedAt: new Date(),
    raw: product as unknown as Prisma.InputJsonValue,
  };
}

// A variation's own `name` is just the chosen option, so the full name is
// composed from the parent — the same label Woo puts on an order line. Status,
// parent and dates come from the variation itself.
export function mapVariation(
  variation: WooVariation,
  parent: WooProduct,
): Prisma.ProductUncheckedCreateInput {
  const options = variation.attributes.map((attribute) => attribute.option).filter(Boolean);
  const name = options.length > 0 ? `${parent.name} - ${options.join(", ")}` : parent.name;

  return {
    wooId: variation.id,
    parentWooId: variation.parent_id,
    sku: blankToNull(variation.sku),
    name,
    type: "variation",
    status: variation.status,
    price: variation.price,
    regularPrice: variation.regular_price,
    salePrice: variation.sale_price,
    stockStatus: variation.stock_status,
    stockQuantity: variation.stock_quantity,
    categories: parent.categories as unknown as Prisma.InputJsonValue,
    modifiedAtWoo: variation.date_modified_gmt ?? variation.date_created_gmt,
    deletedInWoo: false,
    syncedAt: new Date(),
    raw: variation as unknown as Prisma.InputJsonValue,
  };
}

export function mapOrder(
  order: WooOrder,
  contactId: string | null,
): Prisma.OrderUncheckedCreateInput {
  // Woo reports the order total net of discounts but does not send a subtotal,
  // so it is summed from the line items — which is how Woo computes it too.
  const subtotal = order.line_items
    .reduce((sum, item) => sum + Number(item.subtotal), 0)
    .toFixed(2);

  // Woo reports each refund total as a negative string; the order stores the
  // positive magnitude, which is what every revenue query subtracts.
  const refundTotal = order.refunds
    .reduce((sum, refund) => sum + Math.abs(Number(refund.total)), 0)
    .toFixed(2);

  // Woo Analytics derives gross from net plus coupon amounts, so only
  // coupon-backed discounts count. discountTotal can be larger.
  const couponTotal = order.coupon_lines
    .reduce((sum, line) => sum + Number(line.discount), 0)
    .toFixed(2);

  return {
    wooId: order.id,
    number: order.number,
    contactId,
    status: order.status,
    currency: order.currency,
    total: order.total,
    subtotal,
    discountTotal: order.discount_total,
    shippingTotal: order.shipping_total,
    taxTotal: order.total_tax,
    refundTotal,
    couponTotal,
    paymentMethod: blankToNull(order.payment_method),
    paymentMethodTitle: blankToNull(order.payment_method_title),
    couponCodes: order.coupon_lines.map((line) => line.code) as unknown as Prisma.InputJsonValue,
    billing: order.billing as Prisma.InputJsonValue,
    shipping: order.shipping as Prisma.InputJsonValue,
    customerNote: blankToNull(order.customer_note),
    createdAtWoo: order.date_created_gmt,
    paidAtWoo: order.date_paid_gmt,
    completedAtWoo: order.date_completed_gmt,
    modifiedAtWoo: order.date_modified_gmt ?? order.date_created_gmt,
    deletedInWoo: false,
    syncedAt: new Date(),
    raw: order as unknown as Prisma.InputJsonValue,
  };
}

export function mapOrderItems(
  order: WooOrder,
  orderId: string,
): Prisma.OrderItemUncheckedCreateInput[] {
  return order.line_items.map((item) => ({
    orderId,
    wooLineItemId: item.id,
    productWooId: item.product_id === 0 ? null : item.product_id,
    variationWooId: item.variation_id === 0 ? null : item.variation_id,
    sku: blankToNull(item.sku ?? undefined),
    name: item.name,
    quantity: item.quantity,
    subtotal: item.subtotal,
    total: item.total,
  }));
}

export function mapRefund(refund: WooRefund, orderId: string): Prisma.RefundUncheckedCreateInput {
  return {
    wooId: refund.id,
    orderId,
    // Woo reports refund amounts as a positive magnitude.
    amount: refund.amount,
    reason: blankToNull(refund.reason ?? undefined),
    createdAtWoo: refund.date_created_gmt,
    modifiedAtWoo: refund.date_created_gmt,
    deletedInWoo: false,
    syncedAt: new Date(),
    raw: refund as unknown as Prisma.InputJsonValue,
  };
}
