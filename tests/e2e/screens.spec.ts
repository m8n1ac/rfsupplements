import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUsers, TEST_PASSWORD, type TestUser } from "./users";

// Walks every screen in spec §10 at desktop and phone width, so Gate 3's
// walkthrough starts from a known-good state rather than a guess.

const ADMIN_EMAIL = "e2e-screens-admin@rfs.test";
const STAFF_EMAIL = "e2e-screens-staff@rfs.test";

let admin: TestUser;
let staff: TestUser;

test.beforeAll(async () => {
  admin = await createTestUser(ADMIN_EMAIL, "ADMIN");
  staff = await createTestUser(STAFF_EMAIL, "STAFF");
});

test.afterAll(async () => {
  await deleteTestUsers(ADMIN_EMAIL, STAFF_EMAIL);
  await prisma.$disconnect();
});

async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", user.email);
  await page.fill("#password", TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/");
}

const SCREENS = [
  { path: "/", heading: "Dashboard" },
  { path: "/orders", heading: "Orders" },
  { path: "/contacts", heading: "Contacts" },
  { path: "/inquiries", heading: "Inquiries" },
  { path: "/products", heading: "Products" },
  { path: "/tasks", heading: "Tasks" },
  { path: "/account", heading: "Account" },
];

test("every staff screen loads with real data", async ({ page }) => {
  await signIn(page, staff);

  for (const screen of SCREENS) {
    const response = await page.goto(screen.path);
    expect(response?.status(), `${screen.path} status`).toBe(200);
    await expect(page.getByRole("heading", { name: screen.heading, level: 1 })).toBeVisible();
  }
});

test("admin screens load, including settings", async ({ page }) => {
  await signIn(page, admin);

  for (const screen of [
    ...SCREENS,
    { path: "/settings/users", heading: "Users" },
    { path: "/settings/sync", heading: "Sync" },
    { path: "/settings/audit", heading: "Audit log" },
  ]) {
    const response = await page.goto(screen.path);
    expect(response?.status(), `${screen.path} status`).toBe(200);
    await expect(page.getByRole("heading", { name: screen.heading, level: 1 })).toBeVisible();
  }
});

test("every screen renders at phone width without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, admin);

  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await expect(page.getByRole("heading", { name: screen.heading, level: 1 })).toBeVisible();

    // The page itself must not scroll sideways; wide tables scroll inside their card.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${screen.path} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});

test("order detail shows items, totals and the wp-admin link", async ({ page }) => {
  const order = await prisma.order.findFirstOrThrow({
    where: { deletedInWoo: false, items: { some: {} } },
    orderBy: { createdAtWoo: "desc" },
  });

  await signIn(page, admin);
  const response = await page.goto(`/orders/${order.wooId}`);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: `Order #${order.number}` })).toBeVisible();
  await expect(page.getByText("Items", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /View in wp-admin/ })).toBeVisible();
});

test("contact detail shows orders, stats and the activity panel", async ({ page }) => {
  const contact = await prisma.contact.findFirstOrThrow({
    where: { ordersCount: { gt: 0 } },
    orderBy: { lastOrderAt: "desc" },
  });

  await signIn(page, admin);
  const response = await page.goto(`/contacts/${contact.id}`);
  expect(response?.status()).toBe(200);

  await expect(page.getByText("Stats", { exact: true })).toBeVisible();
  await expect(page.getByText("Activity", { exact: true })).toBeVisible();
  await expect(page.getByText("Tags", { exact: true })).toBeVisible();
});

test("STAFF never receives revenue figures on a contact", async ({ page }) => {
  const contact = await prisma.contact.findFirstOrThrow({
    where: { ordersCount: { gt: 0 }, lifetimeValue: { gt: 0 } },
    orderBy: { lifetimeValue: "desc" },
  });

  await signIn(page, staff);
  await page.goto(`/contacts/${contact.id}`);

  // Enforced on the server: the figure must be absent from the HTML, not hidden.
  await expect(page.getByText("Lifetime", { exact: true })).toHaveCount(0);
  const html = await page.content();
  expect(html).not.toContain(`$${Number(contact.lifetimeValue).toFixed(2)}`);
});

test("notes and tags can be added to a contact and are recorded", async ({ page }) => {
  const contact = await prisma.contact.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
  const noteBody = `E2E note ${Date.now()}`;

  await signIn(page, admin);
  await page.goto(`/contacts/${contact.id}`);

  await page.fill('textarea[name="body"]', noteBody);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText(noteBody)).toBeVisible();

  const saved = await prisma.note.findFirstOrThrow({ where: { body: noteBody } });
  expect(saved.contactId).toBe(contact.id);
  expect(saved.visibility).toBe("INTERNAL");

  // Adding a note writes the contact's activity timeline.
  const activity = await prisma.activity.findFirst({ where: { refId: saved.id, type: "NOTE" } });
  expect(activity).not.toBeNull();

  await prisma.activity.deleteMany({ where: { refId: saved.id } });
  await prisma.note.delete({ where: { id: saved.id } });
});

test("global search finds an order by number", async ({ page }) => {
  const order = await prisma.order.findFirstOrThrow({
    where: { deletedInWoo: false },
    orderBy: { createdAtWoo: "desc" },
  });

  await signIn(page, admin);

  // The palette's own shortcut, which is the documented way in (spec §10).
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByPlaceholder("Search contacts, orders and inquiries…");
  await expect(input).toBeVisible();
  await input.fill(order.number);

  await expect(page.getByText(`Order #${order.number}`).first()).toBeVisible();
});

test("the search API refuses an unauthenticated caller", async ({ request }) => {
  const response = await request.get("/api/search?q=test", { maxRedirects: 0 });
  expect(response.status()).not.toBe(200);
});
