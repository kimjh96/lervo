import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * ADR-0561: layout moves the owner reverted. The record is tracked and travels in the revert
 * commit, so every host that pulls the revert keeps the same documents in place instead of moving
 * them again. A document whose bytes later change is planned again.
 */
export const REPOSITORY_LAYOUT_REVERTS_PATH = ".lervo/knowledge/layout-reverts.json";
const MAXIMUM_REVERTED = 256;
const MAXIMUM_BYTES = 256 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;

export interface RevertedRepositoryLayoutMove {
  fromPath: string;
  toPath: string;
  /** The exact source bytes the reverted move carried. */
  contentHash: string;
  /** The layout commit the revert undid. */
  commit: string;
  revertedAt: string;
}

interface RepositoryLayoutRevertState {
  schemaVersion: 1;
  reverted: RevertedRepositoryLayoutMove[];
}

function validMove(value: unknown): value is RevertedRepositoryLayoutMove {
  const item = value as Partial<RevertedRepositoryLayoutMove> | null;
  return (
    typeof item?.fromPath === "string" &&
    typeof item.toPath === "string" &&
    typeof item.contentHash === "string" &&
    HASH.test(item.contentHash) &&
    typeof item.commit === "string" &&
    COMMIT.test(item.commit) &&
    typeof item.revertedAt === "string"
  );
}

/** Every recorded revert; an absent or invalid record holds nothing back. */
export async function readRevertedRepositoryLayoutMoves(
  repositoryRoot: string,
): Promise<RevertedRepositoryLayoutMove[]> {
  try {
    const path = resolve(repositoryRoot, REPOSITORY_LAYOUT_REVERTS_PATH);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.size > MAXIMUM_BYTES) return [];
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<RepositoryLayoutRevertState>;
    return value.schemaVersion === 1 && Array.isArray(value.reverted)
      ? value.reverted.filter(validMove)
      : [];
  } catch {
    return [];
  }
}

/** The recorded revert that holds this exact move back, if any. */
export function revertedRepositoryLayoutMove(
  reverted: readonly RevertedRepositoryLayoutMove[],
  move: { fromPath: string; toPath: string; contentHash: string },
): RevertedRepositoryLayoutMove | null {
  return (
    reverted.find(
      (item) =>
        item.fromPath === move.fromPath &&
        item.toPath === move.toPath &&
        item.contentHash === move.contentHash,
    ) ?? null
  );
}

/** Adds the reverted moves, newest last, keeping the newest 256. Returns the record path. */
export async function recordRevertedRepositoryLayoutMoves(input: {
  repositoryRoot: string;
  moves: ReadonlyArray<Omit<RevertedRepositoryLayoutMove, "revertedAt">>;
  now: Date;
}): Promise<string> {
  const root = resolve(input.repositoryRoot);
  const added = input.moves.map((move) => ({ ...move, revertedAt: input.now.toISOString() }));
  if (!added.every(validMove)) throw new TypeError("A reverted layout move is invalid.");
  const kept = (await readRevertedRepositoryLayoutMoves(root)).filter(
    (item) => revertedRepositoryLayoutMove(added, item) === null,
  );
  const state: RepositoryLayoutRevertState = {
    schemaVersion: 1,
    reverted: [...kept, ...added].slice(-MAXIMUM_REVERTED),
  };
  const path = resolve(root, REPOSITORY_LAYOUT_REVERTS_PATH);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return REPOSITORY_LAYOUT_REVERTS_PATH;
}
