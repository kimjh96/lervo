import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const maximumLeaseBytes = 4 * 1024;
const idPattern = /^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;

interface DeliberationLease {
  schemaVersion: 1;
  deliberationId: string;
  ownerId: string;
  processId: number;
  acquiredAt: string;
}

export class DeliberationLeaseError extends Error {
  constructor(
    readonly code: "deliberation_in_progress" | "deliberation_lease_invalid",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DeliberationLeaseError";
  }
}

function pathFor(stateRoot: string, deliberationId: string): string {
  if (!idPattern.test(deliberationId)) {
    throw new DeliberationLeaseError(
      "deliberation_lease_invalid",
      "The deliberation lease ID is invalid.",
    );
  }
  return resolve(stateRoot, "deliberations", deliberationId, "checkpoints", "active.json");
}

function parseLease(bytes: Uint8Array, deliberationId: string): DeliberationLease {
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as Partial<DeliberationLease> | null;
  if (
    value === null ||
    value.schemaVersion !== 1 ||
    value.deliberationId !== deliberationId ||
    typeof value.ownerId !== "string" ||
    !/^dlw_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(value.ownerId) ||
    !Number.isSafeInteger(value.processId) ||
    value.processId! < 1 ||
    typeof value.acquiredAt !== "string" ||
    !Number.isFinite(Date.parse(value.acquiredAt))
  )
    throw new Error("invalid lease");
  return value as DeliberationLease;
}

async function readLease(path: string, deliberationId: string): Promise<DeliberationLease | null> {
  let handle;
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumLeaseBytes) {
      throw new Error("unsafe lease");
    }
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new Error("lease changed");
    }
    return parseLease(bytes, deliberationId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new DeliberationLeaseError(
      "deliberation_lease_invalid",
      "The deliberation run lease could not be read safely.",
      { cause: error },
    );
  } finally {
    await handle?.close();
  }
}

async function writeLease(path: string, lease: DeliberationLease): Promise<boolean> {
  const directoryPath = dirname(path);
  const deliberationRoot = await lstat(dirname(directoryPath));
  if (!deliberationRoot.isDirectory() || deliberationRoot.isSymbolicLink()) {
    throw new DeliberationLeaseError(
      "deliberation_lease_invalid",
      "The deliberation run directory is unsafe.",
    );
  }
  try {
    await mkdir(directoryPath, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const directory = await lstat(directoryPath);
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new DeliberationLeaseError(
      "deliberation_lease_invalid",
      "The deliberation lease directory is unsafe.",
    );
  }
  let handle;
  try {
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await handle.writeFile(`${JSON.stringify(lease)}\n`, "utf8");
    await handle.sync();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await handle?.close();
  }
}

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function acquireDeliberationLease(input: {
  stateRoot: string;
  deliberationId: string;
  ownerId: string;
  acquiredAt: string;
  recoverStale: boolean;
}): Promise<{ ownerId: string }> {
  const path = pathFor(input.stateRoot, input.deliberationId);
  const lease: DeliberationLease = {
    schemaVersion: 1,
    deliberationId: input.deliberationId,
    ownerId: input.ownerId,
    processId: process.pid,
    acquiredAt: input.acquiredAt,
  };
  if (await writeLease(path, lease)) return { ownerId: input.ownerId };
  const current = await readLease(path, input.deliberationId);
  if (current === null) {
    if (await writeLease(path, lease)) return { ownerId: input.ownerId };
  } else if (!input.recoverStale || processIsAlive(current.processId)) {
    throw new DeliberationLeaseError(
      "deliberation_in_progress",
      "Deliberation is running in another process.",
    );
  } else {
    const stalePath = resolve(dirname(path), `stale-${input.ownerId}.json`);
    try {
      await rename(path, stalePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (await writeLease(path, lease)) {
      await unlink(stalePath).catch(() => undefined);
      return { ownerId: input.ownerId };
    }
  }
  throw new DeliberationLeaseError(
    "deliberation_in_progress",
    "Another process acquired the deliberation resume lease first.",
  );
}

export async function releaseDeliberationLease(input: {
  stateRoot: string;
  deliberationId: string;
  ownerId: string;
}): Promise<void> {
  const path = pathFor(input.stateRoot, input.deliberationId);
  const current = await readLease(path, input.deliberationId);
  if (current === null) return;
  if (current.ownerId !== input.ownerId || current.processId !== process.pid) {
    throw new DeliberationLeaseError(
      "deliberation_lease_invalid",
      "A deliberation lease owned by another run cannot be released.",
    );
  }
  await unlink(path);
}

export async function inspectDeliberationLease(input: {
  stateRoot: string;
  deliberationId: string;
}): Promise<"missing" | "active" | "stale"> {
  const lease = await readLease(
    pathFor(input.stateRoot, input.deliberationId),
    input.deliberationId,
  );
  if (lease === null) return "missing";
  return processIsAlive(lease.processId) ? "active" : "stale";
}

export async function withDeliberationLease<T>(input: {
  stateRoot: string;
  deliberationId: string;
  ownerId: string;
  acquiredAt: string;
  recoverStale: boolean;
  work(): Promise<T>;
}): Promise<T> {
  await acquireDeliberationLease(input);
  let workFailed = false;
  try {
    return await input.work();
  } catch (error) {
    workFailed = true;
    throw error;
  } finally {
    try {
      await releaseDeliberationLease(input);
    } catch (error) {
      // A release failure must replace an otherwise successful result so no stale lease is hidden.
      // eslint-disable-next-line no-unsafe-finally
      if (!workFailed) throw error;
    }
  }
}
