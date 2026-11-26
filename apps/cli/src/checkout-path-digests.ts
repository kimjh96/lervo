import { realpath } from "node:fs/promises";

import { repositoryCoordinateDigest } from "@lervo/project-storage";

/**
 * The path digests that may name the checkout at `root` in a workspace record: its path as given,
 * which worker records use, and its real path, which conversation records use, so a checkout
 * reached through a symbolic link still finds its record.
 */
export async function checkoutPathDigests(root: string): Promise<string[]> {
  const real = await realpath(root).catch(() => root);
  return [...new Set([repositoryCoordinateDigest(root), repositoryCoordinateDigest(real)])];
}
