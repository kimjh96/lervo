import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";

import { MINIMUM_CLAIM_PATH_KEY_BYTES } from "./claim-path-digest.js";
import { AgentWorkforceError } from "./types.js";

/**
 * The repository instance's claim path secret: 32 random bytes in its coordination home, under the
 * Git common directory, which every checkout of the instance shares and nothing tracks or
 * publishes. `assignment.claim.refused` keys its `pathDigest` with it (Lervo ADE coordination).
 */
export const CLAIM_PATH_KEY_FILE = "claim-path-key";

function unsafe(message: string): never {
  throw new AgentWorkforceError("workforce_state_invalid", message);
}

async function readKey(path: string): Promise<Uint8Array> {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size !== MINIMUM_CLAIM_PATH_KEY_BYTES ||
    (process.platform !== "win32" && (info.mode & 0o077) !== 0)
  )
    unsafe("The claim path key must be an owner-only file of exactly 32 bytes.");
  const key = await readFile(path);
  if (key.byteLength !== MINIMUM_CLAIM_PATH_KEY_BYTES) unsafe("The claim path key changed size.");
  return new Uint8Array(key);
}

/**
 * Writes the whole key to a private temporary file, then links it into place, which fails when
 * another process linked its key first: a reader never sees a partial key, and two first uses
 * agree on one key.
 */
async function createKey(path: string, generate: () => Uint8Array): Promise<void> {
  const key = generate();
  if (key.byteLength !== MINIMUM_CLAIM_PATH_KEY_BYTES)
    unsafe("A new claim path key must be exactly 32 bytes.");
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      await handle.writeFile(key);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temporary, path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * The repository instance's claim path key, created on first use. A key that is not an owner-only
 * regular file of 32 bytes fails closed rather than being replaced, since replacing it would make
 * earlier refusals' digests unmatchable.
 */
export async function readOrCreateClaimPathKey(
  repositoryRoot: string,
  options: { generate?: () => Uint8Array } = {},
): Promise<Uint8Array> {
  const home = await resolveRepositoryCoordinationHome(repositoryRoot);
  const path = resolve(home.root, CLAIM_PATH_KEY_FILE);
  try {
    return await readKey(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await createKey(path, options.generate ?? (() => new Uint8Array(randomBytes(32))));
  return readKey(path);
}
