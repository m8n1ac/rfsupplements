import { z } from "zod";

// WooCommerce REST responses are a trust boundary (engineering rule 11), so
// every record is validated before it reaches a mapper. An invalid payload
// fails the run — it is never skipped (spec §6.1 step 3).
//
// Two things about this store's Woo version, both confirmed against the Phase 0
// fixtures:
//   - products report stock as an `in_stock` boolean, not a `stock_status` string
//   - variations carry no *_gmt date fields at all, so their timestamps are read
//     from `date_modified`. That is only correct while the WordPress timezone is
//     UTC, which Gate 0 (A2) requires and this project must not change.

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
    in_stock: z.boolean(),
    stock_quantity: z.number().int().nullable(),
    categories: z.array(z.object({ id: z.number().int(), name: z.string(), slug: z.string() }).loose()),
    date_created_gmt: wooDate,
    date_modified_gmt: wooDateNullable,
  })
  .loose();

// The variations endpoint returns a reduced record: no name, type, status,
// parent_id, categories, or *_gmt dates. The mapper fills those from the parent.
export const wooVariation = z
  .object({
    id: z.number().int(),
    sku: z.string(),
    price: moneyOrEmpty,
    regular_price: moneyOrEmpty,
    sale_price: moneyOrEmpty,
    in_stock: z.boolean(),
    stock_quantity: z.number().int().nullable(),
    attributes: z.array(z.object({ name: z.string(), option: z.string() }).loose()),
    date_created: wooDate,
    date_modified: wooDateNullable,
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

export const wooCouponLine = z.object({ code: z.string() }).loose();

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
  })
  .loose();

export type WooCustomer = z.infer<typeof wooCustomer>;
export type WooProduct = z.infer<typeof wooProduct>;
export type WooVariation = z.infer<typeof wooVariation>;
export type WooOrder = z.infer<typeof wooOrder>;
export type WooRefund = z.infer<typeof wooRefund>;
export type BridgeSubmission = z.infer<typeof bridgeSubmission>;
