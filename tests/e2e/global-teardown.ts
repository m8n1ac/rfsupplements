import { execFileSync } from "node:child_process";

// Always hand the box back the way we found it, including after a failed run.
export default function globalTeardown(): void {
  if (process.env.RFS_RESTART_SYNC_TIMER === "yes") {
    execFileSync("sudo", ["systemctl", "start", "rfs-crm-sync.timer"]);
    console.log("[global-teardown] resumed rfs-crm-sync.timer");
  }
}
