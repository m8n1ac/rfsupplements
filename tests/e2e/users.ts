import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import type { Role } from "@/generated/prisma/enums";

// Test accounts are seeded directly, bypassing the invite flow, so the auth
// tests stay focused on sign-in. They use a .test domain that can never be a
// real address, and are removed again in teardown.
export const TEST_PASSWORD = "e2e-password-not-a-secret";

export type TestUser = { email: string };

export async function createTestUser(email: string, role: Role): Promise<TestUser> {
  await deleteTestUsers(email);
  await prisma.user.create({
    data: {
      email,
      name: `E2E ${role}`,
      role,
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });

  return { email };
}

// Invite.createdBy is Restrict on purpose: production deactivates users, it
// never deletes them (spec §9). Test fixtures therefore clear the invites they
// created before removing the accounts.
export async function deleteTestUsers(...emails: string[]): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);

  await prisma.invite.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
