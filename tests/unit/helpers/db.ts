import { prisma } from "@/lib/db";

// Every integration test starts from an empty database, so a result never
// depends on what ran before it. Children before parents.
export async function resetDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL?.includes("rfs_crm_test")) {
    throw new Error("Refusing to reset: DATABASE_URL is not the test database");
  }

  await prisma.activity.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.note.deleteMany();
  await prisma.task.deleteMany();
  await prisma.order.deleteMany();
  await prisma.inquiry.deleteMany();
  await prisma.contactTag.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.product.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.user.deleteMany();
  await prisma.syncCursor.deleteMany();
  await prisma.syncRun.deleteMany();
}
