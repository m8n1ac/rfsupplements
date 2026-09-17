import { expect, test } from "@playwright/test";
import { prisma } from "../src/lib/db";
import { createInvite } from "../src/lib/invite";
import { deleteTestUsers } from "./users";

// Covers the invite link end to end: open it, set a password, then sign in with
// the credentials just created. Delivering the email is the only step not
// exercised here; it is waiting on the dedicated SMTP App Password.

const EMAIL = "e2e-invite@rfs.test";
const PASSWORD = "e2e-invite-password";

test.afterAll(async () => {
  await deleteTestUsers(EMAIL);
  await prisma.$disconnect();
});

test("an invited user sets a password and signs in", async ({ page }) => {
  await deleteTestUsers(EMAIL);
  const user = await prisma.user.create({
    data: { email: EMAIL, name: "E2E Invitee", role: "STAFF" },
  });
  const token = await createInvite(user.id, user.id);

  await page.goto(`/invite/${token}`);
  await expect(page.getByText("Welcome, E2E Invitee")).toBeVisible();
  await page.fill("#password", PASSWORD);
  await page.fill("#confirm", PASSWORD);
  await page.click('button[type="submit"]');

  await expect(page.getByText(/your account is ready/i)).toBeVisible();

  const after = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  expect(after.passwordHash).not.toBeNull();

  // The invite is single-use, so the same link is now dead.
  await page.goto(`/invite/${token}`);
  await expect(page.getByText("This invite is not valid")).toBeVisible();

  // And the new credentials work.
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("a mismatched confirmation is refused", async ({ page }) => {
  await deleteTestUsers(EMAIL);
  const user = await prisma.user.create({
    data: { email: EMAIL, name: "E2E Invitee", role: "STAFF" },
  });
  const token = await createInvite(user.id, user.id);

  await page.goto(`/invite/${token}`);
  await page.fill("#password", PASSWORD);
  await page.fill("#confirm", `${PASSWORD}-different`);
  await page.click('button[type="submit"]');

  await expect(page.getByText(/do not match/i)).toBeVisible();
});
