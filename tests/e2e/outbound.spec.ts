import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createTestUser, deleteTestUsers, TEST_PASSWORD, type TestUser } from "./users";

// Gate 5. Every write here lands on the clearly-named test order (3744) and
// test customer (57) created for this purpose — never on live customer data
// (spec §13). Phase 6 removes both.

const ADMIN_EMAIL = "e2e-outbound@rfs.test";
const TEST_ORDER_WOO_ID = 3744;
const TEST_CUSTOMER_WOO_ID = 57;

let admin: TestUser;

const authorization = `Basic ${Buffer.from(
  `${env.WOO_USER}:${env.WOO_APP_PASSWORD}`,
).toString("base64")}`;

async function woo(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${env.WOO_BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization,
      accept: "application/json",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return (await response.json()) as Record<string, unknown>;
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", admin.email);
  await page.fill("#password", TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/");
}

test.beforeAll(async () => {
  admin = await createTestUser(ADMIN_EMAIL, "ADMIN");

  // Phase 6 removes the store fixtures at handover. Skip with an instruction
  // rather than failing with a confusing 404 from WooCommerce.
  const order = await woo(`/wc/v3/orders/${TEST_ORDER_WOO_ID}`);
  const customer = await woo(`/wc/v3/customers/${TEST_CUSTOMER_WOO_ID}`);
  const missing = Boolean(order.code) || Boolean(customer.code);

  test.skip(
    missing,
    "Store test fixtures are absent. Recreate them with: npm run fixtures:store -- --create",
  );
});

test.afterAll(async () => {
  // Leave the test order where Phase 2 left it.
  await woo(`/wc/v3/orders/${TEST_ORDER_WOO_ID}`, {
    method: "PUT",
    body: JSON.stringify({ status: "pending" }),
  });
  await deleteTestUsers(ADMIN_EMAIL);
  await prisma.$disconnect();
});

test("a status change reaches WooCommerce and comes back into the CRM", async ({ page }) => {
  await woo(`/wc/v3/orders/${TEST_ORDER_WOO_ID}`, {
    method: "PUT",
    body: JSON.stringify({ status: "pending" }),
  });
  // Re-read so the CRM copy is current before the write.
  const fresh = await woo(`/wc/v3/orders/${TEST_ORDER_WOO_ID}`);
  await prisma.order.update({
    where: { wooId: TEST_ORDER_WOO_ID },
    data: {
      status: "pending",
      modifiedAtWoo: new Date(`${String(fresh.date_modified_gmt)}Z`),
    },
  });

  const auditBefore = await prisma.auditLog.count({ where: { action: "ORDER_STATUS" } });

  await signIn(page);
  await page.goto(`/orders/${TEST_ORDER_WOO_ID}`);

  // on-hold is the transition used throughout: its customer email goes to the
  // test order's example.com address, which reaches no real person.
  await page.selectOption("#status", "on-hold");
  await expect(page.getByRole("heading", { name: "Change status to on-hold?" })).toBeVisible();
  // The dialog must name the actual email WooCommerce sends.
  await expect(page.getByText(/Order on-hold/)).toBeVisible();

  await page.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByText(/is now on-hold/)).toBeVisible();

  // Visible in the store…
  const inWoo = await woo(`/wc/v3/orders/${TEST_ORDER_WOO_ID}`);
  expect(inWoo.status).toBe("on-hold");

  // …and immediately in the CRM, from Woo's own response.
  const inCrm = await prisma.order.findUniqueOrThrow({ where: { wooId: TEST_ORDER_WOO_ID } });
  expect(inCrm.status).toBe("on-hold");

  // Gate 5: every write produces an AuditLog row.
  const auditAfter = await prisma.auditLog.count({ where: { action: "ORDER_STATUS" } });
  expect(auditAfter).toBe(auditBefore + 1);

  const entry = await prisma.auditLog.findFirstOrThrow({
    where: { action: "ORDER_STATUS" },
    orderBy: { at: "desc" },
  });
  expect(entry.before).toEqual({ status: "pending" });
  expect(entry.after).toEqual({ status: "on-hold" });
});

test("a write from a stale page is refused and changes nothing", async ({ page }) => {
  await signIn(page);
  await page.goto(`/orders/${TEST_ORDER_WOO_ID}`);

  // Someone edits the order in the store after this page loaded. The CRM's copy
  // is therefore older than Woo's, which is exactly the stale case: the sync has
  // not caught up yet.
  const edited = await woo(`/wc/v3/orders/${TEST_ORDER_WOO_ID}`, {
    method: "PUT",
    body: JSON.stringify({ customer_note: `stale check ${Date.now()}` }),
  });
  const wooModified = new Date(`${String(edited.date_modified_gmt)}Z`);

  await prisma.order.update({
    where: { wooId: TEST_ORDER_WOO_ID },
    data: { modifiedAtWoo: new Date(wooModified.getTime() - 60_000) },
  });

  const statusBefore = String(edited.status);

  await page.selectOption("#status", "completed");
  await page.getByRole("button", { name: "Change status" }).click();

  await expect(page.getByText(/changed in the store — refresh and try again/)).toBeVisible();

  // Refused means refused: neither side moved.
  const inWoo = await woo(`/wc/v3/orders/${TEST_ORDER_WOO_ID}`);
  expect(inWoo.status).toBe(statusBefore);
  const inCrm = await prisma.order.findUniqueOrThrow({ where: { wooId: TEST_ORDER_WOO_ID } });
  expect(inCrm.status).toBe(statusBefore);
});

test("a WooCommerce error surfaces and nothing is written locally", async ({ page }) => {
  // An order the CRM knows about but WooCommerce does not: the write must fail
  // against Woo and leave the CRM untouched.
  const orphanWooId = 99_999_001;
  const contact = await prisma.contact.findFirstOrThrow({ where: { wooCustomerId: TEST_CUSTOMER_WOO_ID } });

  await prisma.order.deleteMany({ where: { wooId: orphanWooId } });
  await prisma.order.create({
    data: {
      wooId: orphanWooId,
      number: "ZZ-ORPHAN",
      contactId: contact.id,
      status: "pending",
      currency: "USD",
      total: "1.00",
      subtotal: "1.00",
      discountTotal: "0.00",
      shippingTotal: "0.00",
      taxTotal: "0.00",
      createdAtWoo: new Date(),
      modifiedAtWoo: new Date(),
    },
  });

  try {
    await signIn(page);
    await page.goto(`/orders/${orphanWooId}`);

    await page.selectOption("#status", "completed");
    await page.getByRole("button", { name: "Change status" }).click();

    // Woo's own message is shown rather than something generic.
    await expect(page.getByText(/Invalid ID|cannot view|not exist/i)).toBeVisible();

    const unchanged = await prisma.order.findUniqueOrThrow({ where: { wooId: orphanWooId } });
    expect(unchanged.status).toBe("pending");
  } finally {
    // The write failed against Woo, so it wrote no audit row — there is nothing
    // to clean up but the fixture order itself. (An earlier version deleted
    // audit rows with `entityId: undefined`, which in Prisma means "no filter"
    // and wiped every order's audit history.)
    await prisma.order.deleteMany({ where: { wooId: orphanWooId } });
  }
});

test("an order note is written to WooCommerce and stored with its Woo id", async ({ page }) => {
  const body = `ZZ gate5 private note ${Date.now()}`;

  const fresh = await woo(`/wc/v3/orders/${TEST_ORDER_WOO_ID}`);
  await prisma.order.update({
    where: { wooId: TEST_ORDER_WOO_ID },
    data: { modifiedAtWoo: new Date(`${String(fresh.date_modified_gmt)}Z`) },
  });

  await signIn(page);
  await page.goto(`/orders/${TEST_ORDER_WOO_ID}`);

  await page.fill('textarea[name="note"]', body);
  await page.getByRole("button", { name: "Add note in WooCommerce" }).click();
  await expect(page.getByText(/Private note added in WooCommerce/)).toBeVisible();

  const stored = await prisma.note.findFirstOrThrow({ where: { body } });
  expect(stored.visibility).toBe("WOO_PRIVATE");
  expect(stored.wooNoteId).not.toBeNull();

  // Present on the order in the store.
  const notes = (await fetch(`${env.WOO_BASE_URL}/wc/v3/orders/${TEST_ORDER_WOO_ID}/notes`, {
    headers: { authorization, accept: "application/json" },
  }).then((response) => response.json())) as { id: number; note: string }[];
  expect(notes.some((note) => note.id === stored.wooNoteId && note.note.includes(body))).toBe(true);

  const audit = await prisma.auditLog.findFirst({
    where: { action: "ORDER_NOTE" },
    orderBy: { at: "desc" },
  });
  expect(audit).not.toBeNull();
});

test("a customer edit is written to WooCommerce", async ({ page }) => {
  const contact = await prisma.contact.findFirstOrThrow({
    where: { wooCustomerId: TEST_CUSTOMER_WOO_ID },
  });

  const fresh = await woo(`/wc/v3/customers/${TEST_CUSTOMER_WOO_ID}`);
  await prisma.contact.update({
    where: { id: contact.id },
    data: { modifiedAtWoo: new Date(`${String(fresh.date_modified_gmt)}Z`) },
  });

  const newPhone = `555-${String(Date.now()).slice(-4)}`;

  await signIn(page);
  await page.goto(`/contacts/${contact.id}`);
  await page.getByRole("button", { name: "Edit details" }).click();

  // The email is the store login and must not be editable.
  await expect(page.locator("input[value='crm-gate5-customer@example.com']")).toBeDisabled();

  await page.fill("#phone", newPhone);
  await page.getByRole("button", { name: "Save to WooCommerce" }).click();
  await expect(page.getByText(/updated in WooCommerce/)).toBeVisible();

  const inWoo = (await woo(`/wc/v3/customers/${TEST_CUSTOMER_WOO_ID}`)) as {
    billing: { phone: string };
  };
  expect(inWoo.billing.phone).toBe(newPhone);

  const inCrm = await prisma.contact.findUniqueOrThrow({ where: { id: contact.id } });
  expect(inCrm.phone).toBe(newPhone);

  const audit = await prisma.auditLog.findFirst({
    where: { action: "CONTACT_EDIT", entityId: contact.id },
    orderBy: { at: "desc" },
  });
  expect(audit).not.toBeNull();
});

test("a guest contact is labelled CRM-only and never written to the store", async ({ page }) => {
  const guest = await prisma.contact.findFirstOrThrow({
    where: { wooCustomerId: null, source: "WOO_GUEST" },
    orderBy: { createdAt: "asc" },
  });

  await signIn(page);
  await page.goto(`/contacts/${guest.id}`);

  await expect(page.getByText("CRM-only contact")).toBeVisible();
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByText(/Changes stay in the CRM/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
});
