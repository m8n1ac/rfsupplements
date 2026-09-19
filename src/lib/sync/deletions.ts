import { prisma } from "@/lib/db";
import type { SyncResource } from "@/lib/sync/engine";

// A full run compares the complete set of Woo ids against the CRM and marks
// anything missing as deletedInWoo. It never hard-deletes (spec §6.1).

export async function markDeletions(
  resource: SyncResource,
  seenWooIds: number[],
): Promise<number> {
  // An empty result from Woo is treated as "nothing to compare", not "delete
  // everything". A store with zero orders and a broken credential look the same
  // from here, and only one of them should mark the whole table deleted.
  if (seenWooIds.length === 0) {
    return 0;
  }

  const missing = { wooId: { notIn: seenWooIds }, deletedInWoo: false };
  const now = new Date();

  switch (resource) {
    case "products": {
      const result = await prisma.product.updateMany({
        where: missing,
        data: { deletedInWoo: true, syncedAt: now },
      });
      return result.count;
    }
    case "orders": {
      const result = await prisma.order.updateMany({
        where: missing,
        data: { deletedInWoo: true, syncedAt: now },
      });
      return result.count;
    }
    case "refunds": {
      const result = await prisma.refund.updateMany({
        where: missing,
        data: { deletedInWoo: true, syncedAt: now },
      });
      return result.count;
    }
    case "customers": {
      const result = await prisma.contact.updateMany({
        where: { wooCustomerId: { notIn: seenWooIds, not: null }, deletedInWoo: false },
        data: { deletedInWoo: true, syncedAt: now },
      });
      return result.count;
    }
    // The bridge inbox is append-only, and Solid Affiliate has no delete —
    // affiliates and referrals move to a rejected status instead. Nothing to
    // reconcile for any of the three.
    case "submissions":
    case "affiliates":
    case "referrals":
      return 0;
  }
}
