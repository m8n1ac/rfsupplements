import { expect, test, type Page } from "@playwright/test";
import { generate } from "otplib";
import { prisma } from "../src/lib/db";
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
  await page.fill("#code", await generate({ secret: user.secret }));
  await page.click('button[type="submit"]');
}

test("signs in with a password and a TOTP code", async ({ page }) => {
  await signIn(page, admin);
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("rejects a correct password with a wrong TOTP code", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", admin.email);
  await page.fill("#password", TEST_PASSWORD);
  await page.fill("#code", "000000");
  await page.click('button[type="submit"]');

  await expect(page.getByText(/did not work/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // Undo the failed-attempt counter so it cannot bleed into the lockout test.
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
  // Wait for the sign-in redirect to land before navigating on.
  await expect(page).toHaveURL("/");

  const response = await page.goto("/settings/users");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
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
