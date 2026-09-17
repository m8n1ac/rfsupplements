// The inbound sync worker (spec §6.1). Run by systemd timers, not an in-process
// scheduler:
//   npm run sync -- --mode=incremental
//   npm run sync -- --mode=full
import "dotenv/config";

import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import { sendMail } from "../src/lib/mail";
import {
  advanceCursor,
  failRun,
  finishRun,
  readCursor,
  RESOURCES,
  startRun,
  type SyncResource,
} from "../src/lib/sync/engine";
import { markDeletions } from "../src/lib/sync/deletions";
import {
  syncCustomers,
  syncOrders,
  syncProducts,
  syncRefunds,
  syncSubmissions,
  type SyncResult,
} from "../src/lib/sync/resources";
import type { SyncMode } from "../src/generated/prisma/enums";

const RUNNERS: Record<SyncResource, (since: Date | null) => Promise<SyncResult>> = {
  products: syncProducts,
  customers: syncCustomers,
  orders: syncOrders,
  refunds: syncRefunds,
  submissions: syncSubmissions,
};

// Three consecutive failures for a resource sends one alert, and recovery sends
// one more. Nothing else (spec §6.1).
const ALERT_AFTER_FAILURES = 3;

function parseMode(): SyncMode {
  const raw = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1];
  if (raw === "incremental") return "INCREMENTAL";
  if (raw === "full") return "FULL";
  throw new Error("Usage: npm run sync -- --mode=incremental|full");
}

async function alert(subject: string, body: string): Promise<void> {
  // An alert that fails must not mask the sync error that triggered it.
  try {
    await sendMail(env.ALERT_EMAIL, subject, body);
  } catch (error) {
    console.error("Failed to send alert email:", error);
  }
}

async function runResource(resource: SyncResource, mode: SyncMode): Promise<boolean> {
  const runId = await startRun(resource, mode);
  const previousFailures =
    (await prisma.syncCursor.findUnique({ where: { resource } }))?.consecutiveFailures ?? 0;

  try {
    const since = await readCursor(resource, mode);
    const { counts, seenWooIds } = await RUNNERS[resource](since);

    if (mode === "FULL") {
      counts.markedDeleted = await markDeletions(resource, seenWooIds);
      // A full run has now seen everything up to this moment.
      await advanceCursor(resource, new Date());
    }

    await finishRun(runId, resource, counts);
    console.log(
      `${resource}: fetched ${counts.fetched}, upserted ${counts.upserted}, marked deleted ${counts.markedDeleted}`,
    );

    if (previousFailures >= ALERT_AFTER_FAILURES) {
      await alert(
        `[RFS CRM] sync recovered: ${resource}`,
        `The ${resource} sync succeeded again after ${previousFailures} consecutive failures.`,
      );
    }

    return true;
  } catch (error) {
    const failures = await failRun(runId, resource, error, {
      fetched: 0,
      upserted: 0,
      markedDeleted: 0,
    });

    console.error(`${resource} failed (${failures} consecutive):`, error);

    if (failures === ALERT_AFTER_FAILURES) {
      await alert(
        `[RFS CRM] sync failing: ${resource}`,
        `The ${resource} sync has now failed ${failures} times in a row.\n\n${String(error)}`,
      );
    }

    return false;
  }
}

async function main(): Promise<void> {
  const mode = parseMode();
  console.log(`sync start: mode=${mode}`);

  let allSucceeded = true;

  // Resources run in the order §6.1 specifies: products, customers, orders,
  // refunds, submissions. A failure in one does not stop the others — each has
  // its own cursor and its own failure count.
  for (const resource of RESOURCES) {
    const ok = await runResource(resource, mode);
    allSucceeded &&= ok;
  }

  if (!allSucceeded) {
    throw new Error("One or more resources failed; see SyncRun rows above.");
  }

  console.log("sync complete");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    await prisma.$disconnect();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
