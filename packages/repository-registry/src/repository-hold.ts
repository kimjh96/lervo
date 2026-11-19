import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { defaultRepositoryRegistryPath, RepositoryRegistryError } from "./registry.js";
import { shellWord } from "./shell-word.js";

/**
 * ADR-0561: the owner's way to defer one repository. While a repository is held, Lervo applies
 * no effect there on its own: the release follower skips its upgrade, the background knowledge
 * resident runs no stage, and replica conflict resolution keeps the divergence open. Read-only
 * planning and notices continue. The hold is host-level state beside the repository registry,
 * never a tracked repository file, so holding a repository needs no commit.
 */
export interface RepositoryHold {
  /** The canonical repository root the hold names. */
  repositoryRoot: string;
  /** The owner's own words, at most 200 characters, or null. */
  reason: string | null;
  heldAt: string;
}

interface RepositoryHoldFile {
  schemaVersion: 1;
  kind: "lervo_repository_holds";
  holds: RepositoryHold[];
}

const MAXIMUM_HOLDS = 256;
const MAXIMUM_REASON_LENGTH = 200;
const MAXIMUM_FILE_BYTES = 256 * 1024;

/** The command that releases a held repository, ready to paste. */
export function repositoryReleaseCommand(repositoryRoot: string): string {
  return `lervo repository release --root ${shellWord(repositoryRoot)}`;
}

/** The hold file sits in the same owner-only directory as the repository registry. */
export function defaultRepositoryHoldPath(environment: NodeJS.ProcessEnv = process.env): string {
  return resolve(dirname(defaultRepositoryRegistryPath(environment)), "repository-holds.json");
}

function validReason(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAXIMUM_REASON_LENGTH &&
      !/[\0-\x1f\x7f]/u.test(value))
  );
}

function validHold(value: unknown): value is RepositoryHold {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const hold = value as Record<string, unknown>;
  return (
    Object.keys(hold).sort().join(",") === "heldAt,reason,repositoryRoot" &&
    typeof hold.repositoryRoot === "string" &&
    isAbsolute(hold.repositoryRoot) &&
    !/[\0\r\n]/u.test(hold.repositoryRoot) &&
    validReason(hold.reason) &&
    typeof hold.heldAt === "string" &&
    Number.isFinite(Date.parse(hold.heldAt))
  );
}

/**
 * Reads every hold. A missing file holds nothing. A file that exists but cannot be read or
 * validated throws `repository_hold_invalid`; callers that act on their own treat that as a hold.
 */
export async function readRepositoryHolds(
  path: string = defaultRepositoryHoldPath(),
): Promise<RepositoryHold[]> {
  let bytes: string;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAXIMUM_FILE_BYTES)
      throw new RepositoryRegistryError("repository_hold_invalid", "The hold file is unsafe.");
    bytes = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    if (error instanceof RepositoryRegistryError) throw error;
    throw new RepositoryRegistryError("repository_hold_invalid", "The hold file is unreadable.", {
      cause: error,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    throw new RepositoryRegistryError("repository_hold_invalid", "The hold file is not JSON.", {
      cause: error,
    });
  }
  const file = value as Partial<RepositoryHoldFile> | null;
  if (
    file === null ||
    typeof file !== "object" ||
    file.schemaVersion !== 1 ||
    file.kind !== "lervo_repository_holds" ||
    !Array.isArray(file.holds) ||
    file.holds.length > MAXIMUM_HOLDS ||
    !file.holds.every(validHold)
  )
    throw new RepositoryRegistryError("repository_hold_invalid", "The hold file is invalid.");
  return file.holds;
}

async function canonicalRoot(root: string): Promise<string> {
  const absolute = resolve(root);
  return realpath(absolute).catch(() => absolute);
}

/**
 * The hold on one repository, or null. Fails closed: when the hold file is unreadable, every
 * repository counts as held until the file is repaired, because a lost hold could let Lervo apply
 * an effect the owner deferred.
 */
export async function readRepositoryHold(
  repositoryRoot: string,
  path: string = defaultRepositoryHoldPath(),
): Promise<RepositoryHold | null> {
  const root = await canonicalRoot(repositoryRoot);
  try {
    return (await readRepositoryHolds(path)).find((hold) => hold.repositoryRoot === root) ?? null;
  } catch {
    return {
      repositoryRoot: root,
      reason: "The repository hold file is unreadable; every repository counts as held.",
      heldAt: new Date(0).toISOString(),
    };
  }
}

async function writeHolds(path: string, holds: readonly RepositoryHold[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(6).toString("hex")}.next`;
  const file: RepositoryHoldFile = {
    schemaVersion: 1,
    kind: "lervo_repository_holds",
    holds: [...holds].sort((left, right) =>
      left.repositoryRoot.localeCompare(right.repositoryRoot),
    ),
  };
  try {
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Holds one repository; holding it again replaces the reason and keeps the first time. */
export async function holdRepository(input: {
  repositoryRoot: string;
  reason?: string | null;
  now?: Date;
  path?: string;
}): Promise<RepositoryHold> {
  const path = input.path ?? defaultRepositoryHoldPath();
  const reason = input.reason === undefined || input.reason === "" ? null : input.reason;
  if (!validReason(reason))
    throw new RepositoryRegistryError(
      "repository_hold_reason_invalid",
      `A hold reason is one line of at most ${MAXIMUM_REASON_LENGTH} characters.`,
    );
  const root = await canonicalRoot(input.repositoryRoot);
  const holds = await readRepositoryHolds(path);
  const existing = holds.find((hold) => hold.repositoryRoot === root);
  const hold: RepositoryHold = {
    repositoryRoot: root,
    reason,
    heldAt: existing?.heldAt ?? (input.now ?? new Date()).toISOString(),
  };
  const next = [...holds.filter((item) => item.repositoryRoot !== root), hold];
  if (next.length > MAXIMUM_HOLDS)
    throw new RepositoryRegistryError(
      "repository_hold_limit_exceeded",
      `At most ${MAXIMUM_HOLDS} repositories can be held on one host.`,
    );
  await writeHolds(path, next);
  return hold;
}

/** Releases the hold on one repository; returns the released hold, or null when none existed. */
export async function releaseRepositoryHold(input: {
  repositoryRoot: string;
  path?: string;
}): Promise<RepositoryHold | null> {
  const path = input.path ?? defaultRepositoryHoldPath();
  const root = await canonicalRoot(input.repositoryRoot);
  const holds = await readRepositoryHolds(path);
  const existing = holds.find((hold) => hold.repositoryRoot === root) ?? null;
  if (existing !== null)
    await writeHolds(
      path,
      holds.filter((hold) => hold.repositoryRoot !== root),
    );
  return existing;
}
