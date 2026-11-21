import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname, uptime } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

/**
 * ADR-0602: which host, boot and pid namespace a process runs in. A FIFO, a lock or a pid only
 * means something on the kernel that made it, so FIFO names and records carry this identity.
 *
 * - Same host, same boot: the same kernel. ENXIO on a FIFO, or a pid check in the same pid
 *   namespace, proves a subscriber gone.
 * - Same host, another boot: that kernel is not running, so it is gone.
 * - Another host, or an unknown key: it cannot be judged here, so it is reported, never removed.
 */
export interface LocalProcessIdentity {
  /** 12 hex characters naming the machine, or "unknown". */
  host: string;
  /** "b<12 hex>" from the kernel boot id, "t<seconds>" from the boot time, or "unknown". */
  boot: string;
  pid: number;
  /** The pid namespace (Linux), or "" where there is only one. */
  pidNamespace: string;
}

/** Boot times derived from the clock and the uptime differ by less than this within one boot. */
const BOOT_TIME_TOLERANCE_SECONDS = 120;

const hash12 = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);

let cachedBoot: string | undefined;
/** The boot key, from a file read on Linux and from the uptime elsewhere: never a process. */
export function localBootKey(): string {
  if (cachedBoot !== undefined) return cachedBoot;
  if (process.platform === "linux") {
    try {
      cachedBoot = `b${hash12(readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim())}`;
      return cachedBoot;
    } catch {
      // Fall back to the boot time.
    }
  }
  const seconds = Math.round(Date.now() / 1000 - uptime());
  cachedBoot = Number.isFinite(seconds) && seconds > 0 ? `t${seconds}` : "unknown";
  return cachedBoot;
}

/** Whether two boot keys name the same boot; null when either is unknown or they differ in kind. */
export function sameBoot(left: string, right: string): boolean | null {
  if (left === "unknown" || right === "unknown") return null;
  if (left[0] !== right[0]) return null;
  if (left.startsWith("b")) return left === right;
  const difference = Math.abs(Number(left.slice(1)) - Number(right.slice(1)));
  return Number.isFinite(difference) ? difference <= BOOT_TIME_TOLERANCE_SECONDS : null;
}

function readMachineId(): string | null {
  if (process.platform === "linux") {
    for (const path of ["/etc/machine-id", "/var/lib/dbus/machine-id"])
      try {
        const id = readFileSync(path, "utf8").trim();
        if (id.length > 0) return id;
      } catch {
        // Try the next source.
      }
    return null;
  }
  try {
    if (process.platform === "darwin") {
      const output = execFileSync("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return /"IOPlatformUUID" = "([^"]+)"/u.exec(output)?.[1] ?? null;
    }
    if (process.platform === "win32") {
      const output = execFileSync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return /MachineGuid\s+REG_SZ\s+(\S+)/u.exec(output)?.[1] ?? null;
    }
  } catch {
    // The platform tool is unavailable: the host stays unknown.
  }
  return null;
}

/**
 * This user's private Lervo state directory on this host: never a shared temporary directory.
 * `LERVO_USER_STATE_DIRECTORY` overrides it, as for the repository registry.
 */
export function userStateDirectory(): string {
  const override = process.env.LERVO_USER_STATE_DIRECTORY;
  if (override !== undefined && isAbsolute(override)) return override;
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "Lervo");
  if (process.platform === "win32")
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "Lervo");
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "lervo");
}

/** Reads the cached key only from a regular file of this user that nobody else can touch. */
function readCachedHostKey(path: string): string | null {
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink()) return null;
    if (process.platform !== "win32") {
      if (stats.uid !== process.geteuid?.() || (stats.mode & 0o077) !== 0) return null;
    }
    const value = readFileSync(path, "utf8").trim();
    return /^[0-9a-f]{12}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeCachedHostKey(path: string, value: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // A random name opened exclusively: an existing file or symlink there makes it fail.
    const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    writeFileSync(temporary, `${value}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } catch {
    // Uncached: the next process reads the machine id again.
  }
}

let cachedHost: string | undefined;
/**
 * The host key: the machine id (Linux machine-id, macOS IOPlatformUUID, Windows MachineGuid) with
 * the host name, so cloned machine ids and shared home directories still give two machines two
 * keys. The key decides only removal and reporting, never whether a FIFO is pinged, so a host
 * name change turns this host's leftovers into kept and reported files and loses no wake. Only
 * Linux reads its id from a file; the macOS and Windows tools run once per host and user, and the
 * result is cached in the user's private state directory.
 */
export function localHostKey(): string {
  if (cachedHost !== undefined) return cachedHost;
  // Named after the host, so a home directory shared by several machines keeps one cache each.
  const cache = join(userStateDirectory(), `host-key-${hash12(hostname())}`);
  if (process.platform !== "linux") {
    const cached = readCachedHostKey(cache);
    if (cached !== null) return (cachedHost = cached);
  }
  const id = readMachineId();
  cachedHost = id === null ? "unknown" : hash12(`${id}\0${hostname()}`);
  if (process.platform !== "linux" && cachedHost !== "unknown")
    writeCachedHostKey(cache, cachedHost);
  return cachedHost;
}

function pidNamespace(): string {
  if (process.platform !== "linux") return "";
  try {
    return readlinkSync("/proc/self/ns/pid");
  } catch {
    return "unknown";
  }
}

export function localProcessIdentity(): LocalProcessIdentity {
  return {
    host: localHostKey(),
    boot: localBootKey(),
    pid: process.pid,
    pidNamespace: pidNamespace(),
  };
}

export type KernelRelation = "same_kernel" | "other_boot" | "foreign" | "unknown";

/**
 * How a host and boot relate to this process's kernel. A Linux boot id is random per boot, so an
 * equal one is the same kernel even across containers whose machine ids differ. Otherwise the
 * host must be known and equal; a different boot of this host is not running any more.
 */
export function kernelRelation(host: string, boot: string): KernelRelation {
  const bootSame = sameBoot(boot, localBootKey());
  if (bootSame === true && boot.startsWith("b")) return "same_kernel";
  const self = localHostKey();
  if (host === "unknown" || self === "unknown") return "unknown";
  if (host !== self) return "foreign";
  if (bootSame === null) return "unknown";
  return bootSame ? "same_kernel" : "other_boot";
}

/**
 * Whether the process `identity` names is alive: true or false when this process can tell, null
 * when it cannot (another host, an unknown key, or another pid namespace).
 */
export function localProcessAlive(identity: LocalProcessIdentity): boolean | null {
  const relation = kernelRelation(identity.host, identity.boot);
  if (relation === "other_boot") return false;
  if (relation !== "same_kernel") return null;
  const self = pidNamespace();
  if (identity.pidNamespace !== self || self === "unknown") return null;
  try {
    process.kill(identity.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
