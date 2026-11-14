import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { readCoordinationMarker } from "./coordination-marker.js";
import type { RepositoryCoordinationHome } from "./types.js";

const MAXIMUM_REMEMBERED_HOMES = 64;

interface InitializedCoordinationHome {
  home: RepositoryCoordinationHome;
  projectId: string;
  legacyWorkforce: string;
}

/**
 * Homes this process initialized completely, keyed by repository root. Every workforce read
 * resolves its home, and full initialization takes an fsynced exclusive lock. A remembered
 * home is returned only while repeating initialization would provably change nothing.
 */
const initialized = new Map<string, InitializedCoordinationHome>();

async function absent(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function realDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The state `ensurePrivateDirectory` leaves behind: an owned real directory with mode 0700. */
async function privateDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return (
      info.isDirectory() &&
      !info.isSymbolicLink() &&
      (process.platform === "win32" ||
        (info.uid === process.getuid?.() && (info.mode & 0o7777) === 0o700))
    );
  } catch {
    return false;
  }
}

/**
 * Full initialization would be a no-op exactly when the checkout-local workforce it migrates is
 * gone, every directory it ensures is already private, every parent it inspects is a real
 * directory, the marker it reads is the same valid one, and no peer holds or abandoned its lock.
 * The lock is checked last: a peer that began initializing while the state above was read makes
 * the hit fall through, so a hit is as settled as the state the full path sees after releasing
 * its own lock.
 */
async function unchanged(
  entry: InitializedCoordinationHome,
  coordinate: { root: string; storageKind: RepositoryCoordinationHome["storageKind"] },
  projectId: string,
): Promise<boolean> {
  const { home } = entry;
  if (
    home.root !== coordinate.root ||
    home.storageKind !== coordinate.storageKind ||
    entry.projectId !== projectId
  )
    return false;
  const ensured = [
    ...(home.storageKind === "standalone_checkout" ? [dirname(home.root)] : []),
    home.root,
    home.workforce,
    home.workspaces,
    home.integrations,
    home.integrationAttempts,
    home.cleanupJournals,
    home.events,
    home.locks,
  ];
  const checks = await Promise.all([
    absent(entry.legacyWorkforce),
    realDirectory(dirname(ensured[0]!)),
    ...ensured.map(privateDirectory),
  ]);
  if (checks.includes(false)) return false;
  try {
    const marker = await readCoordinationMarker(resolve(home.root, "repository.json"), projectId);
    if (
      marker.repositoryInstanceId !== home.repositoryInstanceId ||
      marker.storageKind !== home.storageKind
    )
      return false;
  } catch {
    return false;
  }
  return absent(resolve(home.root, ".initializing.lock"));
}

export async function rememberedCoordinationHome(
  repositoryRoot: string,
  coordinate: { root: string; storageKind: RepositoryCoordinationHome["storageKind"] },
  projectId: string,
): Promise<RepositoryCoordinationHome | null> {
  const entry = initialized.get(repositoryRoot);
  if (entry === undefined) return null;
  if (await unchanged(entry, coordinate, projectId)) return { ...entry.home };
  initialized.delete(repositoryRoot);
  return null;
}

export function rememberInitializedCoordinationHome(
  repositoryRoot: string,
  entry: InitializedCoordinationHome,
): void {
  initialized.delete(repositoryRoot);
  if (initialized.size >= MAXIMUM_REMEMBERED_HOMES)
    initialized.delete(initialized.keys().next().value!);
  initialized.set(repositoryRoot, { ...entry, home: { ...entry.home } });
}
