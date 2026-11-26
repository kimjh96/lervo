// ADR-0645: what a Stop needs to know about the cached base, kept apart from the server's writer.
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import { terminalHookRuntimeStorePath } from "@lervo/repository-knowledge";

/** The directory beside the context socket that holds cached answers and their markers. */
export const TERMINAL_CACHED_BASE_DIRECTORY = "base";

/** The 16 hex digits the launcher names a cached-base file or marker by. */
export function terminalCachedBaseNameDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** The host's cached-base directory, beside the context socket. */
export function terminalCachedBaseDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  return resolve(terminalHookRuntimeStorePath(environment), TERMINAL_CACHED_BASE_DIRECTORY);
}

/**
 * Whether the launcher answered this session's latest prompt from the cached base after `since`,
 * the time its latest prepared context was recorded. Such a turn prepared nothing, so its Stop
 * must not take the earlier turn's context for its own.
 */
export async function answeredFromCachedBaseSince(
  providerSessionId: string,
  since: number,
  directory: string = terminalCachedBaseDirectory(),
): Promise<boolean> {
  try {
    return (
      (await lstat(resolve(directory, `${terminalCachedBaseNameDigest(providerSessionId)}.turn`)))
        .mtimeMs > since
    );
  } catch {
    return false;
  }
}
