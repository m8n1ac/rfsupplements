import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUsers, TEST_PASSWORD, type TestUser } from "./users";

const ADMIN_EMAIL = "e2e-admin@rfs.test";
const STAFF_EMAIL = "e2e-staff@rfs.test";

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

async function signIn(page: Page, user: TestUser, password = TEST_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.fill("#email", user.email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
}

test("signs in with email and password", async ({ page }) => {
  await signIn(page, admin);
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("rejects a wrong password", async ({ page }) => {
  await signIn(page, admin, "not-the-right-password");
  await expect(page.getByText(/did not work/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await prisma.user.update({
    where: { email: admin.email },
    data: { failedLogins: 0, lockedUntil: null },
  });
});

test("STAFF gets a server-side 403 from Settings", async ({ page }) => {
  await signIn(page, staff);
  await expect(page).toHaveURL("/");

  // The status code matters, not just the rendered page (spec §13).
  const response = await page.goto("/settings/users");
  expect(response?.status()).toBe(403);
  await expect(page.getByText(/administrators/i)).toBeVisible();
});

test("ADMIN can load Settings", async ({ page }) => {
  await signIn(page, admin);
  await expect(page).toHaveURL("/");

  const response = await page.goto("/settings/users");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
});

test("a deactivated user is signed out on their next request", async ({ page }) => {
  await signIn(page, staff);
  await expect(page).toHaveURL("/");

  // requireUser() reloads from the database, so this takes effect immediately.
  await prisma.user.update({ where: { email: staff.email }, data: { active: false } });

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);

  await prisma.user.update({ where: { email: staff.email }, data: { active: true } });
});

test("locks the account after 5 bad passwords", async ({ page }) => {
  await prisma.user.update({
    where: { email: staff.email },
    data: { failedLogins: 0, lockedUntil: null },
  });

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await signIn(page, staff, "definitely-the-wrong-password");
    await expect(page.getByText(/did not work/i)).toBeVisible();
  }

  const locked = await prisma.user.findUniqueOrThrow({
    where: { email: staff.email },
    select: { failedLogins: true, lockedUntil: true },
  });
  expect(locked.failedLogins).toBe(5);
  expect(locked.lockedUntil).not.toBeNull();
  expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

  // And the right password is now refused too, while the lock holds.
  await signIn(page, staff);
  await expect(page.getByText(/did not work/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
