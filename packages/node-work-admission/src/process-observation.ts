import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { win32 } from "node:path";

import { darwinBirthIdentity, linuxBirthIdentity, windowsBirthIdentity } from "./process-birth.js";

export type ProcessObservation =
  { status: "present"; identity: string } | { status: "absent" } | { status: "unknown" };

function absent(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

function command(file: string, args: string[]): string {
  return execFileSync(file, args, {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 4096,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC" },
  });
}

/**
 * The current boot's identity, read once per process: it cannot change while this process runs,
 * and reading it spawned `sysctl` on every observation, blocking a long-lived process's event loop.
 */
let bootIdentity: string | undefined;
function currentBoot(): string {
  bootIdentity ??=
    process.platform === "darwin"
      ? command("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"])
      : readFileSync("/proc/sys/kernel/random/boot_id", "utf8");
  return bootIdentity;
}

function birth(pid: number): string | null {
  switch (process.platform) {
    case "linux":
      return linuxBirthIdentity(pid, currentBoot(), readFileSync(`/proc/${pid}/stat`, "utf8"));
    case "darwin":
      return darwinBirthIdentity(
        pid,
        currentBoot(),
        command("/bin/ps", ["-p", String(pid), "-o", "lstart="]),
      );
    case "win32": {
      const root = process.env.SystemRoot;
      if (root === undefined || !win32.isAbsolute(root)) return null;
      const script = `$ErrorActionPreference='Stop'; [System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToFileTimeUtc().ToString([System.Globalization.CultureInfo]::InvariantCulture)`;
      return windowsBirthIdentity(
        pid,
        command(win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          script,
        ]),
      );
    }
    default:
      return null;
  }
}

/** Only this process's immutable birth observation is cached, for one store lifetime. */
export function createProcessObserver(): (pid: number) => ProcessObservation {
  let self: ProcessObservation | undefined;
  return (pid) => {
    if (!Number.isSafeInteger(pid) || pid < 1) return { status: "unknown" };
    if (pid === process.pid && self?.status === "present") return self;
    if (absent(pid)) return { status: "absent" };
    try {
      const identity = birth(pid);
      if (identity !== null) {
        const observed = { status: "present" as const, identity };
        if (pid === process.pid) self = observed;
        return observed;
      }
    } catch {
      // Failed metadata access is not evidence that an owner exited.
    }
    return absent(pid) ? { status: "absent" } : { status: "unknown" };
  };
}
