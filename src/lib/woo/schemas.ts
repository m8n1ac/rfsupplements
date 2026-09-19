import { z } from "zod";

// WooCommerce REST responses are a trust boundary (engineering rule 11), so
// every record is validated before it reaches a mapper. An invalid payload
// fails the run — it is never skipped (spec §6.1 step 3).
//
// Two things about this store's Woo version, both confirmed against the Phase 0
// fixtures:
// Shapes here are validated against fixtures captured from the live API by
// scripts/capture-fixtures.ts, not hand-written, because hand-kept fixtures
// drift from the API and give false confidence.

// Woo emits "2026-09-10T19:08:27" with no zone marker. The *_gmt fields are UTC.
export const wooDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "expected a Woo datetime")
  .transform((value) => new Date(`${value}Z`));

export const wooDateNullable = z
  .union([wooDate, z.literal(""), z.null()])
  .transform((value) => (value instanceof Date ? value : null));

// Money arrives as a decimal string. It is kept as a string all the way into
// Prisma's Decimal so it never passes through a float. "" means "not set".
const money = z.string().regex(/^-?\d+(\.\d+)?$/, "expected a decimal string");
const moneyOrEmpty = z
  .union([money, z.literal("")])
  .transform((value) => (value === "" ? null : value));

const address = z
  .object({
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    company: z.string().optional(),
    address_1: z.string().optional(),
    address_2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postcode: z.string().optional(),
    country: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  })
  .loose();

export const wooCustomer = z
  .object({
    id: z.number().int(),
    email: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    date_created_gmt: wooDate,
    date_modified_gmt: wooDateNullable,
    billing: address,
    shipping: address,
  })
  .loose();

export const wooProduct = z
  .object({
    id: z.number().int(),
    parent_id: z.number().int(),
    name: z.string(),
    sku: z.string(),
    type: z.string(),
    status: z.string(),
    price: moneyOrEmpty,
    regular_price: moneyOrEmpty,
    sale_price: moneyOrEmpty,
    stock_status: z.string(),
    stock_quantity: z.number().int().nullable(),
    categories: z.array(z.object({ id: z.number().int(), name: z.string(), slug: z.string() }).loose()),
    date_created_gmt: wooDate,
    date_modified_gmt: wooDateNullable,
  })
  .loose();

// A variation carries its own status, parent_id and dates. Its `name` is only
// the chosen option ("Green Apple"), so the mapper composes the full name from
// the parent, matching how Woo labels the same item on an order line.
export const wooVariation = z
  .object({
    id: z.number().int(),
    parent_id: z.number().int(),
    status: z.string(),
    sku: z.string(),
    price: moneyOrEmpty,
    regular_price: moneyOrEmpty,
    sale_price: moneyOrEmpty,
    stock_status: z.string(),
    stock_quantity: z.number().int().nullable(),
    attributes: z.array(z.object({ name: z.string(), option: z.string() }).loose()),
    date_created_gmt: wooDate,
    date_modified_gmt: wooDateNullable,
  })
  .loose();

export const wooLineItem = z
  .object({
    id: z.number().int(),
    name: z.string(),
    product_id: z.number().int(),
    variation_id: z.number().int(),
    sku: z.string().nullable(),
    quantity: z.number().int(),
    subtotal: money,
    total: money,
  })
  .loose();

export const wooCouponLine = z
  .object({ code: z.string(), discount: z.string() })
  .loose();

// Every order carries a summary of its refunds. It has no date, so it is not
// enough to build a Refund row, but it tells the sync which orders to fetch
// details for — 3 requests instead of one per order.
// Shipment tracking, written by whichever label service is in use. The key is
// carrier-agnostic: WooCommerce Shipping wrote it before 4 Sep 2026 and Shippo
// writes it now, in the same shape.
export const wooTrackingItem = z
  .object({
    tracking_number: z.string(),
    tracking_provider: z.string().optional(),
    custom_tracking_provider: z.string().optional(),
    custom_tracking_link: z.string().optional(),
  })
  .loose();

export const wooMetaData = z
  .object({ key: z.string(), value: z.unknown() })
  .loose();

export const wooRefundSummary = z
  .object({ id: z.number().int(), total: z.string() })
  .loose();

export const wooOrder = z
  .object({
    id: z.number().int(),
    number: z.string(),
    status: z.string(),
    currency: z.string(),
    customer_id: z.number().int(),
    total: money,
    total_tax: money,
    discount_total: money,
    shipping_total: money,
    payment_method: z.string(),
    payment_method_title: z.string(),
    customer_note: z.string(),
    billing: address,
    shipping: address,
    line_items: z.array(wooLineItem),
    coupon_lines: z.array(wooCouponLine),
    refunds: z.array(wooRefundSummary),
    meta_data: z.array(wooMetaData),
    date_created_gmt: wooDate,
    date_modified_gmt: wooDateNullable,
    date_paid_gmt: wooDateNullable,
    date_completed_gmt: wooDateNullable,
  })
  .loose();

export const wooRefund = z
  .object({
    id: z.number().int(),
    amount: money,
    reason: z.string().nullable(),
    date_created_gmt: wooDate,
  })
  .loose();

// From the rfs-crm-bridge mu-plugin, not from WooCommerce.
export const bridgeSubmission = z
  .object({
    id: z.number().int(),
    source_plugin: z.string(),
    form_id: z.string(),
    form_name: z.string(),
    submitted_at_gmt: wooDate,
    modified_at_gmt: wooDate,
    fields: z.record(z.string(), z.unknown()),
    page_url: z.string(),
    // "mail_failed" means the inquiry is real but the relay refused the email,
    // so the CRM is the only place it exists.
    mail_status: z.string(),
  })
  .loose();

// Also from the bridge: Solid Affiliate's tables, which publish no REST API of
// their own. Money crosses as a decimal string for the same reason Woo's does.
export const bridgeAffiliate = z
  .object({
    id: z.number().int(),
    user_id: z.number().int(),
    email: z.string(),
    payment_email: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    status: z.string(),
    commission_type: z.string(),
    commission_rate: money,
    created_at_gmt: wooDateNullable,
    updated_at_gmt: wooDateNullable,
  })
  .loose();

export const bridgeReferral = z
  .object({
    id: z.number().int(),
    affiliate_id: z.number().int(),
    // Null when Solid Affiliate recorded no order against the referral.
    order_id: z.number().int().nullable(),
    order_amount: money,
    commission_amount: money,
    status: z.string(),
    referral_type: z.string(),
    referral_source: z.string(),
    description: z.string(),
    refunded_at_gmt: wooDateNullable,
    created_at_gmt: wooDateNullable,
    updated_at_gmt: wooDateNullable,
  })
  .loose();

export type WooCustomer = z.infer<typeof wooCustomer>;
export type WooProduct = z.infer<typeof wooProduct>;
export type WooVariation = z.infer<typeof wooVariation>;
export type WooOrder = z.infer<typeof wooOrder>;
export type WooRefund = z.infer<typeof wooRefund>;
export type BridgeSubmission = z.infer<typeof bridgeSubmission>;
export type BridgeAffiliate = z.infer<typeof bridgeAffiliate>;
export type BridgeReferral = z.infer<typeof bridgeReferral>;
