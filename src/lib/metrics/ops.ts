import "server-only";

import { prisma } from "@/lib/db";
import { RESOURCES } from "@/lib/sync/engine";

// The ops queues from spec §11. Visible to ADMIN and STAFF alike: none of them
// carry revenue.

export type OpsQueues = {
  processingOver48h: number;
  onHoldOrPending: number;
  failedLast7Days: number;
  unassignedNewInquiries: number;
  inquiriesAwaitingFirstResponse: number;
  lowOrOutOfStock: number;
  myTasksDueOrOverdue: number;
  syncHealthy: boolean;
  staleResources: string[];
};

// Red when any resource's last success is more than 10 minutes old (spec §11).
const SYNC_STALE_MS = 10 * 60_000;
const LOW_STOCK_THRESHOLD = 5;

export async function opsQueues(userId: string, now: Date): Promise<OpsQueues> {
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 3_600_000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3_600_000);
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);

  const [
    processingOver48h,
    onHoldOrPending,
    failedLast7Days,
    unassignedNewInquiries,
    inquiriesAwaitingFirstResponse,
    lowOrOutOfStock,
    myTasksDueOrOverdue,
    cursors,
  ] = await Promise.all([
    prisma.order.count({
      where: {
        deletedInWoo: false,
        status: "processing",
        createdAtWoo: { lt: fortyEightHoursAgo },
      },
    }),
    prisma.order.count({
      where: { deletedInWoo: false, status: { in: ["on-hold", "pending"] } },
    }),
    prisma.order.count({
      where: {
        deletedInWoo: false,
        status: "failed",
        createdAtWoo: { gte: sevenDaysAgo },
      },
    }),
    prisma.inquiry.count({ where: { status: "NEW", assigneeId: null } }),
    prisma.inquiry.count({
      where: {
        firstResponseAt: null,
        closedAt: null,
        submittedAt: { lt: twentyFourHoursAgo },
      },
    }),
    prisma.product.count({
      where: {
        deletedInWoo: false,
        status: "publish",
        OR: [
          { stockStatus: "outofstock" },
          { stockQuantity: { lte: LOW_STOCK_THRESHOLD, not: null } },
        ],
      },
    }),
    prisma.task.count({
      where: { assigneeId: userId, doneAt: null, dueAt: { lte: endOfToday } },
    }),
    prisma.syncCursor.findMany(),
  ]);

  const bySuccess = new Map(cursors.map((cursor) => [cursor.resource, cursor.lastSuccessAt]));
  const staleResources = RESOURCES.filter((resource) => {
    const lastSuccess = bySuccess.get(resource);
    return !lastSuccess || now.getTime() - lastSuccess.getTime() > SYNC_STALE_MS;
  });

  return {
    processingOver48h,
    onHoldOrPending,
    failedLast7Days,
    unassignedNewInquiries,
    inquiriesAwaitingFirstResponse,
    lowOrOutOfStock,
    myTasksDueOrOverdue,
    syncHealthy: staleResources.length === 0,
    staleResources,
  };
}

export type LtvBucket = { label: string; contacts: number };

// LTV distribution, in fixed buckets so the shape is comparable between periods.
export async function ltvDistribution(): Promise<LtvBucket[]> {
  const rows = await prisma.$queryRaw<{ bucket: number; contacts: bigint }[]>`
    SELECT
      CASE
        WHEN lifetimeValue <  50  THEN 0
        WHEN lifetimeValue < 100  THEN 1
        WHEN lifetimeValue < 250  THEN 2
        WHEN lifetimeValue < 500  THEN 3
        WHEN lifetimeValue < 1000 THEN 4
        ELSE 5
      END           AS bucket,
      COUNT(*)      AS contacts
    FROM Contact
    WHERE deletedInWoo = 0 AND ordersCount > 0
    GROUP BY bucket
    ORDER BY bucket
  `;

  const labels = ["under $50", "$50–99", "$100–249", "$250–499", "$500–999", "$1,000+"];
  const counts = new Map(rows.map((row) => [Number(row.bucket), Number(row.contacts)]));

  return labels.map((label, index) => ({ label, contacts: counts.get(index) ?? 0 }));
}
