// The versions of installed Lervo CLIs, so an older install that something still runs never
// undoes what a newer one did on this host.
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

import { compareVersions } from "./host-follow-policy.js";

/** The version of the installed `@lervo/cli` whose `dist/bin.js` is `entry`, or null. */
export async function installedCliVersion(entry: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(dirname(entry), "..", "package.json"), "utf8"),
    ) as { name?: unknown; version?: unknown };
    return manifest.name === "@lervo/cli" &&
      typeof manifest.version === "string" &&
      /^\d+\.\d+\.\d+$/u.test(manifest.version)
      ? manifest.version
      : null;
  } catch {
    return null;
  }
}

/**
 * The real `dist/bin.js` the host's `lervo` link runs: the install a host upgrade, or a rollback,
 * activated. The link lives in ADR-0571's default bin directory; a host that moved it, or has none,
 * yields null.
 */
export async function activeCliEntry(
  binDirectory: string = resolve(homedir(), ".local", "bin"),
): Promise<string | null> {
  return realpath(resolve(binDirectory, "lervo")).catch(() => null);
}

/**
 * The version of the active install that published the host runtime, when `version` is older, or
 * null. Every installed CLI publishes its runtime when it starts, so an older install that still
 * runs, such as a Stop's worker bound before an upgrade, would otherwise put its older runtime and
 * launcher back; on 2026-11-26 one did on the Mac every few minutes after 0.58.0 was installed.
 * Only the active install counts: after a rollback, the newer install that published stays on disk
 * but is no longer active, and the active older CLI publishes and repairs its own runtime again.
 */
export async function newerRuntimePublisher(
  store: string,
  version: string | null,
  active: string | null,
): Promise<string | null> {
  if (version === null || active === null) return null;
  try {
    const pointer = JSON.parse(await readFile(resolve(store, "current.json"), "utf8")) as {
      publisher?: unknown;
    };
    if (pointer.publisher !== active || !isAbsolute(active)) return null;
    const publisher = await installedCliVersion(active);
    return publisher !== null && compareVersions(publisher, version) > 0 ? publisher : null;
  } catch {
    return null;
  }
}

/**
 * Whether the host runtime's embedded event reader reads every schema a writer of `version`
 * selects: the runtime is `contentHash`, this CLI's own, or an install at least as new as
 * `version` published it (ADR-0650). Repair authority accepts another live publisher's runtime,
 * so without this an older install's runtime would pass the event writer's hook reader preflight.
 * A publisher whose version cannot be read counts as older.
 */
export async function runtimeReadsWriterOf(
  store: string,
  contentHash: string,
  version: string,
): Promise<boolean> {
  try {
    const pointer = JSON.parse(await readFile(resolve(store, "current.json"), "utf8")) as {
      contentHash?: unknown;
      publisher?: unknown;
    };
    if (pointer.contentHash === contentHash) return true;
    if (typeof pointer.publisher !== "string" || !isAbsolute(pointer.publisher)) return false;
    const publisher = await installedCliVersion(pointer.publisher);
    return publisher !== null && compareVersions(publisher, version) >= 0;
  } catch {
    return false;
  }
}
