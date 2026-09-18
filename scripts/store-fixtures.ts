// Creates or removes the clearly-named test artifacts the outbound suite writes
// to, so tests never touch live customer data (spec §13).
//
//   npm run fixtures:store -- --create
//   npm run fixtures:store -- --remove
//
// Phase 6 removes them at handover. Anyone re-running tests/e2e/outbound.spec.ts
// recreates them first; the suite skips with this command in the message if they
// are absent.
import "dotenv/config";

import { env } from "../src/lib/env";

const authorization = `Basic ${Buffer.from(
  `${env.WOO_USER}:${env.WOO_APP_PASSWORD}`,
).toString("base64")}`;

export const FIXTURE_SKU = "ZZ-CRM-SYNC-PROBE";
export const FIXTURE_CUSTOMER_EMAIL = "crm-gate5-customer@example.com";

// Woo's shapes vary per endpoint here; each caller narrows what it reads.
type WooJson = Record<string, unknown> & { id?: number; code?: string };

async function woo(path: string, init?: RequestInit): Promise<WooJson | WooJson[]> {
  const response = await fetch(`${env.WOO_BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization,
      accept: "application/json",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return (await response.json()) as WooJson | WooJson[];
}

async function findProduct(): Promise<number | null> {
  const found = await woo(`/wc/v3/products?sku=${FIXTURE_SKU}&status=any`);
  return Array.isArray(found) && found[0] ? Number(found[0].id) : null;
}

async function findCustomer(): Promise<number | null> {
  const found = await woo(`/wc/v3/customers?email=${encodeURIComponent(FIXTURE_CUSTOMER_EMAIL)}`);
  return Array.isArray(found) && found[0] ? Number(found[0].id) : null;
}

export const FIXTURE_ORDER_EMAIL = "crm-gate-test@example.com";

// Matched on the billing email, which is exact. Woo's order `search` does not
// cover customer_note, so searching the note text silently finds nothing and
// creates a duplicate every run.
async function findOrders(): Promise<number[]> {
  const found = await woo(
    `/wc/v3/orders?search=${encodeURIComponent(FIXTURE_ORDER_EMAIL)}&status=any&per_page=50`,
  );
  if (!Array.isArray(found)) return [];
  return found
    .filter((order) => (order.billing as { email?: string } | undefined)?.email === FIXTURE_ORDER_EMAIL)
    .map((order) => Number(order.id))
    .sort((a, b) => a - b);
}

async function findOrder(): Promise<number | null> {
  const [first] = await findOrders();
  return first ?? null;
}

async function create(): Promise<void> {
  let productId = await findProduct();
  if (!productId) {
    const product = await woo("/wc/v3/products", {
      method: "POST",
      body: JSON.stringify({
        name: "ZZ TEST - CRM Sync Probe (do not sell)",
        type: "simple",
        status: "private",
        catalog_visibility: "hidden",
        regular_price: "0.01",
        sku: FIXTURE_SKU,
        description: "Created by the Ops CRM test suite. Safe to trash.",
      }),
    });
    productId = Number((product as WooJson).id);
  }
  console.log(`product ${productId}`);

  let customerId = await findCustomer();
  if (!customerId) {
    const customer = await woo("/wc/v3/customers", {
      method: "POST",
      body: JSON.stringify({
        email: FIXTURE_CUSTOMER_EMAIL,
        first_name: "ZZ CRM",
        last_name: "Gate5 Test",
        username: `zz-crm-test-${Date.now()}`,
      }),
    });
    customerId = Number((customer as WooJson).id);
  }
  console.log(`customer ${customerId}`);

  let orderId = await findOrder();
  if (!orderId) {
    const order = await woo("/wc/v3/orders", {
      method: "POST",
      body: JSON.stringify({
        // pending sends no email and is excluded from Woo's revenue reporting.
        status: "pending",
        billing: {
          first_name: "ZZ CRM",
          last_name: "Gate Test",
          email: "crm-gate-test@example.com",
          address_1: "1 Sample Way",
          city: "Springfield",
          state: "AZ",
          postcode: "00000",
          country: "US",
        },
        line_items: [{ product_id: productId, quantity: 1 }],
        customer_note: "ZZ TEST order for the Ops CRM suite. Safe to cancel and trash.",
      }),
    });
    orderId = Number((order as WooJson).id);
  }
  console.log(`order ${orderId}`);
}

async function remove(): Promise<void> {
  // Every fixture order, not just the first: an earlier bug could have left
  // duplicates behind.
  for (const orderId of await findOrders()) {
    // Cancelled first so it can never count toward revenue, then trashed.
    await woo(`/wc/v3/orders/${orderId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
    await woo(`/wc/v3/orders/${orderId}`, { method: "DELETE" });
    console.log(`order ${orderId} cancelled and trashed`);
  }

  const productId = await findProduct();
  if (productId) {
    await woo(`/wc/v3/products/${productId}`, { method: "DELETE" });
    console.log(`product ${productId} trashed`);
  }

  const customerId = await findCustomer();
  if (customerId) {
    await woo(`/wc/v3/customers/${customerId}?force=true&reassign=0`, { method: "DELETE" });
    console.log(`customer ${customerId} deleted`);
  }
}

const mode = process.argv.includes("--remove") ? "remove" : process.argv.includes("--create") ? "create" : null;

if (!mode) {
  console.error("Usage: npm run fixtures:store -- --create|--remove");
  process.exit(1);
}

(mode === "create" ? create() : remove()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
