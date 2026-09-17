// Re-captures test fixtures from the live WooCommerce API and scrubs personal
// data before writing them into tests/fixtures.
//
//   npm run fixtures:capture
//
// This exists because the Phase 0 fixtures did not match the live API: they
// carried an `in_stock` boolean the API does not send, and omitted fields
// variations really do have. Fixtures that drift from the API give false
// confidence, so they are generated rather than hand-kept.
import "dotenv/config";

import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { env } from "../src/lib/env";

const authorization = `Basic ${Buffer.from(
  `${env.WOO_USER}:${env.WOO_APP_PASSWORD}`,
).toString("base64")}`;

const FIRST = ["Alex", "Jordan", "Riley", "Casey", "Morgan"];
const LAST = ["Doe", "Roe", "Poe", "Noe", "Coe"];
const STREETS = ["1 Sample Way", "22 Placeholder Rd", "350 Fixture Blvd", "7 Testing Ln"];
const CITIES = ["Springfield", "Rivertown", "Fairview", "Lakeside City", "Northgate"];

function pick(pool: string[], seed: string): string {
  const digest = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  return pool[parseInt(digest, 16) % pool.length];
}

const ADDRESS_KEYS = new Set(["address", "address_1", "address_2", "street", "street1", "street2"]);
const CITY_KEYS = new Set(["city", "town", "locality"]);
const POSTCODE_KEYS = new Set(["postcode", "postal_code", "zip", "zipcode"]);
const PERSON_NAME_KEYS = new Set(["name", "full_name", "recipient", "contact_name"]);

// Product and line-item names must survive, so a "name" is only treated as a
// person's name inside a shipping or carrier block.
function scrub(key: string, value: string, inShipment: boolean): string {
  const k = key.toLowerCase();
  if (!value.trim()) return value;
  if (k === "email" || k.endsWith("_email")) {
    return `${pick(FIRST, value).toLowerCase()}.${pick(LAST, value).toLowerCase()}@example.com`;
  }
  if (k === "first_name") return pick(FIRST, value);
  if (k === "last_name") return pick(LAST, value);
  if (ADDRESS_KEYS.has(k)) return pick(STREETS, value);
  if (CITY_KEYS.has(k)) return pick(CITIES, value);
  if (POSTCODE_KEYS.has(k)) return "00000";
  if (k === "state" || k === "province") return "AZ";
  if (k === "phone" || k.endsWith("_phone")) return "555-0100";
  if (k === "company") return "";
  if (k === "customer_ip_address") return "203.0.113.10";
  if (k === "customer_user_agent") return "Mozilla/5.0 (scrubbed)";
  if (k === "username" || k === "avatar_url") return "scrubbed";
  if (inShipment && PERSON_NAME_KEYS.has(k)) return `${pick(FIRST, value)} ${pick(LAST, value)}`;
  return value;
}

function walk(node: unknown, inShipment = false): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => walk(item, inShipment));
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const shipment =
      inShipment ||
      "destination" in record ||
      "shipment_0" in record ||
      "address" in record ||
      "postal_code" in record;

    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        typeof value === "string" ? scrub(key, value, shipment) : walk(value, shipment),
      ]),
    );
  }
  return node;
}

async function get(path: string): Promise<unknown> {
  const response = await fetch(`${env.WOO_BASE_URL}${path}`, {
    headers: { authorization, accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} for ${path}: ${await response.text()}`);
  }
  return response.json();
}

async function capture(name: string, path: string, index?: number): Promise<void> {
  const payload = await get(path);
  const record = index === undefined ? payload : (payload as unknown[])[index];
  if (record === undefined) {
    throw new Error(`No record at index ${index} for ${path}`);
  }
  const target = new URL(`../tests/fixtures/${name}.json`, import.meta.url);
  writeFileSync(target, `${JSON.stringify(walk(record), null, 2)}\n`);
  console.log(`captured ${name}`);
}

async function main(): Promise<void> {
  await capture("product-simple", "/wc/v3/products?per_page=100&status=any&type=simple", 0);
  await capture("product-variable", "/wc/v3/products?per_page=100&status=any&type=variable", 0);
  // The parent of the captured variation, so name composition can be tested.
  await capture("product-parent", "/wc/v3/products/1668");
  await capture("product-variation", "/wc/v3/products/1668/variations?per_page=1", 0);
  await capture("customer", "/wc/v3/customers?per_page=1&orderby=id&order=asc", 0);
  await capture("order-guest", "/wc/v3/orders/3737");
  await capture("order-coupon", "/wc/v3/orders/3740");
  await capture("order-refunded", "/wc/v3/orders/3728");
  await capture("refund", "/wc/v3/orders/3728/refunds?per_page=1", 0);
  await capture("order-notes", "/wc/v3/orders/3728/notes?per_page=1", 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
