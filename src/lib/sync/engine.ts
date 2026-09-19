import { prisma } from "@/lib/db";
import type { SyncMode } from "@/generated/prisma/enums";

// Cursor and run bookkeeping, shared by every resource (spec §6.1 steps 1, 5, 6).
//
// The cursor advances only after a page has committed, so killing the process
// mid-run leaves it at the last committed page and the next run resumes there.

export type SyncResource =
  | "products"
  | "customers"
  | "orders"
  | "refunds"
  | "submissions"
  | "affiliates"
  | "referrals";

// Order matters: affiliates before referrals, because a referral is skipped if
// its affiliate is not in the database yet.
export const RESOURCES: SyncResource[] = [
  "products",
  "customers",
  "orders",
  "refunds",
  "submissions",
  "affiliates",
  "referrals",
];

// Full mode re-reads everything, so it starts from a null cursor (spec §6.1).
export async function readCursor(
  resource: SyncResource,
  mode: SyncMode,
): Promise<Date | null> {
  if (mode === "FULL") {
    return null;
  }

  const cursor = await prisma.syncCursor.findUnique({ where: { resource } });
  return cursor?.lastModifiedGmt ?? null;
}

export async function advanceCursor(resource: SyncResource, to: Date): Promise<void> {
  await prisma.syncCursor.upsert({
    where: { resource },
    create: { resource, lastModifiedGmt: to },
    update: { lastModifiedGmt: to },
  });
}

export async function startRun(resource: SyncResource, mode: SyncMode): Promise<string> {
  const run = await prisma.syncRun.create({ data: { resource, mode } });
  return run.id;
}

export type RunCounts = { fetched: number; upserted: number; markedDeleted: number };

export async function finishRun(
  runId: string,
  resource: SyncResource,
  counts: RunCounts,
): Promise<void> {
  await prisma.$transaction([
    prisma.syncRun.update({
      where: { id: runId },
      data: { ...counts, finishedAt: new Date() },
    }),
    prisma.syncCursor.upsert({
      where: { resource },
      create: { resource, consecutiveFailures: 0, lastSuccessAt: new Date() },
      update: { consecutiveFailures: 0, lastSuccessAt: new Date() },
    }),
  ]);
}

// Returns the new consecutive-failure count, so the caller can decide whether
// this is the third strike that warrants an alert (spec §6.1).
export async function failRun(
  runId: string,
  resource: SyncResource,
  error: unknown,
  counts: RunCounts,
): Promise<number> {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  const [, cursor] = await prisma.$transaction([
    prisma.syncRun.update({
      where: { id: runId },
      data: { ...counts, finishedAt: new Date(), error: message },
    }),
    prisma.syncCursor.upsert({
      where: { resource },
      create: { resource, consecutiveFailures: 1 },
      update: { consecutiveFailures: { increment: 1 } },
    }),
  ]);

  return cursor.consecutiveFailures;
}

export function maxModified(dates: (Date | null)[]): Date | null {
  const valid = dates.filter((date): date is Date => date !== null);
  if (valid.length === 0) {
    return null;
  }
  return new Date(Math.max(...valid.map((date) => date.getTime())));
}

// Woo's modified_after is exclusive of nothing — it is a >= style filter in
// practice — so the cursor is stored as the exact max seen and re-reading the
// boundary record on the next run is harmless: every write is an upsert.
export function cursorParams(since: Date | null): Record<string, string> {
  if (!since) {
    return {};
  }
  return {
    modified_after: since.toISOString().replace(/\.\d{3}Z$/, ""),
    dates_are_gmt: "true",
  };
}
