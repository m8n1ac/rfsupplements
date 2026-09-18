import { execFileSync } from "node:child_process";

// The outbound suite asserts stale-write behaviour, which means the CRM's copy
// of an order must stay older than the store's for the length of a test. The
// incremental sync runs every 60 seconds and repairs exactly that, so a long
// run would randomly "fix" the condition under test.
//
// The timer is therefore paused for the suite and restored afterwards. This is
// the same reason the restore test pauses it (ops/rfs-crm-backup.sh).

const TIMER = "rfs-crm-sync.timer";

function systemctl(...args: string[]): string {
  return execFileSync("sudo", ["systemctl", ...args], { encoding: "utf8" }).trim();
}

export function timerIsActive(): boolean {
  try {
    return systemctl("is-active", TIMER) === "active";
  } catch {
    return false;
  }
}

export default function globalSetup(): void {
  if (timerIsActive()) {
    systemctl("stop", TIMER);
    process.env.RFS_RESTART_SYNC_TIMER = "yes";
    console.log(`[global-setup] paused ${TIMER} for the run`);
  }

  // A run already in flight keeps going after the timer stops.
  for (let waited = 0; waited < 60; waited += 2) {
    try {
      if (systemctl("is-active", "rfs-crm-sync.service") !== "active") break;
    } catch {
      break;
    }
    execFileSync("sleep", ["2"]);
  }
}
