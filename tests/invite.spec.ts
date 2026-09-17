import { expect, test } from "@playwright/test";
import { generate } from "otplib";
import { prisma } from "../src/lib/db";
import { decrypt } from "../src/lib/crypto";
import { createInvite } from "../src/lib/invite";
import { deleteTestUsers } from "./users";

// Covers the invite link end to end: set a password, enrol TOTP, receive the
// recovery codes, then sign in with the credentials that were just created.
// Delivering the email is the only step not exercised here; it is waiting on
// the dedicated SMTP App Password.

const EMAIL = "e2e-invite@rfs.test";
const PASSWORD = "e2e-invite-password";

test.afterAll(async () => {
  await deleteTestUsers(EMAIL);
  await prisma.$disconnect();
});

test("an invited user sets a password, enrols TOTP, and signs in", async ({ page }) => {
  await deleteTestUsers(EMAIL);
  const user = await prisma.user.create({
    data: { email: EMAIL, name: "E2E Invitee", role: "STAFF" },
  });
  const token = await createInvite(user.id, user.id);

  // Step 1 — choose a password.
  await page.goto(`/invite/${token}`);
  await expect(page.getByText("Welcome, E2E Invitee")).toBeVisible();
  await page.fill("#password", PASSWORD);
  await page.fill("#confirm", PASSWORD);
  await page.click('button[type="submit"]');

  // Step 2 — the QR code and the manual-entry key.
  await expect(page.getByAltText("TOTP enrolment QR code")).toBeVisible();

  const stored = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { totpSecret: true },
  });
  const secret = decrypt(stored.totpSecret!);

  await page.fill("#code", await generate({ secret }));
  await page.click('button[type="submit"]');

  // Step 3 — eight single-use recovery codes, shown exactly once.
  await expect(page.getByText(/will not be shown again/i)).toBeVisible();
  const codes = await page.locator("ul li").allTextContents();
  expect(codes).toHaveLength(8);

  const stateAfter = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true, totpEnrolledAt: true, _count: { select: { recoveryCodes: true } } },
  });
  expect(stateAfter.passwordHash).not.toBeNull();
  expect(stateAfter.totpEnrolledAt).not.toBeNull();
  expect(stateAfter._count.recoveryCodes).toBe(8);

  // The invite is single-use, so the same link is now dead.
  await page.goto(`/invite/${token}`);
  await expect(page.getByText("This invite is not valid")).toBeVisible();

  // And the new credentials work.
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.fill("#code", await generate({ secret }));
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("a recovery code works in place of the authenticator, once", async ({ page }) => {
  const existing = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  const code = await prisma.recoveryCode.findFirstOrThrow({
    where: { userId: existing.id, usedAt: null },
  });

  // The plaintext codes are never stored, so this test re-issues one it knows.
  const { hashRecoveryCode } = await import("../src/lib/totp");
  const known = "ABCDE-12345";
  await prisma.recoveryCode.update({
    where: { id: code.id },
    data: { codeHash: await hashRecoveryCode(known), usedAt: null },
  });

  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.fill("#code", known);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL("/");

  const used = await prisma.recoveryCode.findUniqueOrThrow({ where: { id: code.id } });
  expect(used.usedAt).not.toBeNull();

  // Second use is refused. Drop the session first, since /login redirects
  // away once signed in.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.fill("#code", known);
  await page.click('button[type="submit"]');
  await expect(page.getByText(/did not work/i)).toBeVisible();
});
