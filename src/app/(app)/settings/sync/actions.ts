"use server";

import { revalidatePath } from "next/cache";
import { spawn } from "node:child_process";
import { requireUser } from "@/lib/require-user";
import { prisma } from "@/lib/db";

export type SyncActionState = { error: string | null; notice: string | null };

// Kicks off a full sync in the background (spec §6.1: "and on demand from
// Settings → Sync"). It deliberately does not wait: a full run takes minutes,
// and its progress is visible in the run history below.
export async function runFullSync(
  _prev: SyncActionState,
  _formData: FormData,
): Promise<SyncActionState> {
  const admin = await requireUser("ADMIN");

  const child = spawn("npm", ["run", "sync", "--", "--mode=full"], {
    cwd: process.env.RFS_CRM_DIR ?? "/opt/rfs-crm",
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  await prisma.auditLog.create({
    data: { userId: admin.id, action: "SYNC_FULL_RUN", entity: "SyncRun" },
  });

  revalidatePath("/settings/sync");
  return { error: null, notice: "Full sync started. Refresh to watch it land below." };
}
