import { createHmac } from "node:crypto";

/** The smallest key a repository instance's claim path secret may have. */
export const MINIMUM_CLAIM_PATH_KEY_BYTES = 32;

/**
 * `assignment.claim.refused`'s `pathDigest`: the HMAC-SHA-256 of `lervo.claim.path.v1` and the path,
 * joined by NUL, under the repository instance's local secret, so a replicated event names no
 * guessable path. The `hmac-sha256:` prefix keeps it apart from unkeyed `sha256:` digests.
 */
export function claimPathDigest(key: Uint8Array, path: string): string {
  if (key.byteLength < MINIMUM_CLAIM_PATH_KEY_BYTES)
    throw new TypeError("The claim path key is too short.");
  return `hmac-sha256:${createHmac("sha256", key).update(`lervo.claim.path.v1\0${path}`).digest("hex")}`;
}
