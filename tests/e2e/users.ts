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

// Invites, notes and tasks all reference a user with Restrict on purpose:
// production deactivates users, it never deletes them (spec §9). Test fixtures
// therefore clear everything they authored before removing the accounts.
export async function deleteTestUsers(...emails: string[]): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length === 0) return;

  const notes = await prisma.note.findMany({
    where: { authorId: { in: ids } },
    select: { id: true },
  });
  const tasks = await prisma.task.findMany({
    where: { OR: [{ assigneeId: { in: ids } }, { createdById: { in: ids } }] },
    select: { id: true },
  });

  // Activity rows point at their note or task by refId, with no foreign key.
  await prisma.activity.deleteMany({
    where: { refId: { in: [...notes.map((n) => n.id), ...tasks.map((t) => t.id)] } },
  });
  await prisma.note.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.task.deleteMany({
    where: { OR: [{ assigneeId: { in: ids } }, { createdById: { in: ids } }] },
  });
  await prisma.invite.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
