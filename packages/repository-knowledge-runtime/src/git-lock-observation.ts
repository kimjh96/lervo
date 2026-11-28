import { execFile } from "node:child_process";
import { access, readFile, realpath } from "node:fs/promises";
import { basename, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const TIMEOUT_MS = 3000;
const WINDOWS_TASKLIST = "/mnt/c/Windows/System32/tasklist.exe";

/**
 * The checks that make an index lock provably abandoned. Each answers null when it cannot tell,
 * and an unknown answer never makes a lock stale: a lock Lervo cannot prove abandoned keeps the
 * ordinary `git_unavailable_or_busy` report.
 */
export interface GitLockObservation {
  /** Whether a Git process is visible on this host, Windows included under WSL. */
  gitProcessVisible(): Promise<boolean | null>;
  /** Whether the directory is on local storage, where no other host can hold the lock. */
  localStorage(directory: string): Promise<boolean | null>;
}

function linuxGitCommand(line: string): boolean {
  const command = basename(line.trim());
  return command === "git" || command.startsWith("git-");
}

/**
 * True when `hidepid` hides other users' processes, so an empty `ps` proves nothing. Null when
 * the mount table is unreadable, which is the case off Linux, where `ps` lists every process.
 */
export function processesHidden(mounts: string | null): boolean | null {
  if (mounts === null) return process.platform === "linux" ? null : false;
  return mounts
    .split("\n")
    .map((line) => line.split(" "))
    .some(
      ([, , type, options]) =>
        type === "proc" &&
        (options ?? "").split(",").some((option) => /^hidepid=(?!0$|off$)/u.test(option)),
    );
}

/** Whether `tasklist /FO CSV` output lists `git.exe`; a no-match notice lists nothing. */
export function windowsGitListed(stdout: string): boolean {
  return /^"git\.exe",/imu.test(stdout);
}

/** Whether `git.exe` runs on Windows, when this is WSL; false where there is no Windows side. */
async function windowsGitRunning(): Promise<boolean | null> {
  if (
    !(await access(WINDOWS_TASKLIST).then(
      () => true,
      () => false,
    ))
  )
    return false;
  try {
    const { stdout } = await execute(
      WINDOWS_TASKLIST,
      ["/FI", "IMAGENAME eq git.exe", "/NH", "/FO", "CSV"],
      { encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
    );
    return windowsGitListed(stdout);
  } catch {
    return null;
  }
}

async function procMounts(): Promise<string | null> {
  return readFile("/proc/mounts", "utf8").catch(() => null);
}

export async function gitProcessVisible(): Promise<boolean | null> {
  const [listed, hidden, windows] = await Promise.all([
    execute("ps", ["-A", "-o", "comm="], {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    }).then(
      ({ stdout }) => stdout.split("\n").some(linuxGitCommand),
      () => null,
    ),
    procMounts().then(processesHidden),
    windowsGitRunning(),
  ]);
  if (listed === true || windows === true) return true;
  return listed === null || hidden !== false || windows === null ? null : false;
}

/** Linux file system types another machine can share, where its Git may hold the lock. */
const SHARED_TYPES = /^(nfs4?|cifs|smb3?|smbfs|9p|ceph|glusterfs|afs|lustre|virtiofs|fuse\..*)$/u;

function unescapeMountPoint(value: string): string {
  return value.replace(/\\([0-7]{3})/gu, (_match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}

function within(path: string, mountPoint: string): boolean {
  return mountPoint === "/" || path === mountPoint || path.startsWith(`${mountPoint}${sep}`);
}

/** The deepest mount containing `path` from `/proc/mounts`, as its file system type. */
export function linuxMountType(mounts: string, path: string): string | null {
  let best: { point: string; type: string } | null = null;
  for (const line of mounts.split("\n")) {
    const [, rawPoint, type] = line.split(" ");
    if (rawPoint === undefined || type === undefined) continue;
    const point = unescapeMountPoint(rawPoint);
    if (within(path, point) && (best === null || point.length > best.point.length))
      best = { point, type };
  }
  return best?.type ?? null;
}

/** The deepest mount containing `path` from BSD `mount` output: whether it is flagged `local`. */
async function bsdMountLocal(path: string): Promise<boolean | null> {
  const { stdout } = await execute("mount", [], { encoding: "utf8", timeout: TIMEOUT_MS });
  let best: { point: string; local: boolean } | null = null;
  for (const line of stdout.split("\n")) {
    const match = /^.+? on (.+) \(([^)]*)\)$/u.exec(line);
    if (match === null) continue;
    const point = match[1]!;
    const local = match[2]!.split(", ").includes("local");
    if (within(path, point) && (best === null || point.length > best.point.length))
      best = { point, local };
  }
  return best?.local ?? null;
}

export async function localStorage(directory: string): Promise<boolean | null> {
  try {
    const path = await realpath(directory);
    const mounts = await procMounts();
    if (mounts !== null) {
      const type = linuxMountType(mounts, path);
      return type === null ? null : !SHARED_TYPES.test(type);
    }
    return await bsdMountLocal(path);
  } catch {
    return null;
  }
}

export const hostGitLockObservation: GitLockObservation = { gitProcessVisible, localStorage };
