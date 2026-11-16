import { execFile } from "node:child_process";
import { resolve } from "node:path";

import { CommandFailure } from "./command-error-output.js";
import {
  readActivationJournal,
  readHostLinks,
  recordActivation,
  settleActivation,
  switchHostLinks,
  type HostActivationRecord,
  type HostLinkChange,
} from "./host-cli-activation.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";

/**
 * ADR-0571 health gate. `version` runs the `lervo` link as a user's shell would: through its
 * `#!/usr/bin/env node` line, the executable bit, and the `node` on PATH, so a too-old `node` or a
 * lost executable bit fails here; `--version` has no startup effects. `syntax` is only a link and
 * parse check of `lervo-node`, not runtime health: starting a Node runtime binds runtime
 * records and has no side-effect-free mode.
 */
export interface HostCliProbes {
  version: (executable: string) => Promise<string>;
  syntax: (executable: string) => Promise<void>;
}

const probeTimeoutMilliseconds = 60_000;

const run = (command: string, args: string[]) =>
  new Promise<string>((resolvePromise, reject) => {
    execFile(
      command,
      args,
      { timeout: probeTimeoutMilliseconds, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout) => (error === null ? resolvePromise(stdout) : reject(error)),
    );
  });

export const installedCliProbes: HostCliProbes = {
  version: (executable) => run(executable, ["--version"]),
  syntax: async (executable) => {
    await run("node", ["--check", executable]);
  },
};

/** What the gate expects of `lervo --version`; null when no `lervo` link remains to run. */
export type HostVersionExpectation = RegExp | null;

const targetsOf = (changes: HostLinkChange[], side: "previous" | "current") =>
  new Map(changes.map((change) => [change.name, change[side]]));

async function linksHealthy(
  layout: HostUpgradeLayout,
  probes: HostCliProbes,
  links: HostLinkChange[],
  expected: HostVersionExpectation,
): Promise<boolean> {
  if (expected !== null) {
    const output = await probes.version(resolve(layout.binDirectory, "lervo")).catch(() => null);
    if (output === null || !expected.test(output.trim())) return false;
  }
  if (links.some((link) => link.name === "lervo-node" && link.current !== null))
    return probes
      .syntax(resolve(layout.binDirectory, "lervo-node"))
      .then(() => true)
      .catch(() => false);
  return true;
}

/**
 * Switches links under a `pending` record, health-checks them, and settles the record: `active`
 * on success, or `restored` after putting the previous links back. If even the restore fails, the
 * record stays `pending` and the next run reconciles it.
 */
export async function activateLinks(
  layout: HostUpgradeLayout,
  probes: HostCliProbes,
  record: HostActivationRecord,
  expected: HostVersionExpectation,
): Promise<HostActivationRecord[]> {
  await recordActivation(layout, record);
  const previous = targetsOf(record.links, "previous");
  try {
    await switchHostLinks(layout, targetsOf(record.links, "current"), previous);
  } catch (error) {
    await settleActivation(layout, record.activationId, "restored");
    throw error;
  }
  if (!(await linksHealthy(layout, probes, record.links, expected))) {
    await switchHostLinks(layout, previous, previous);
    await settleActivation(layout, record.activationId, "restored");
    const executable = resolve(layout.binDirectory, "lervo");
    throw new CommandFailure(
      "host_upgrade_health_failed",
      `The switched links in ${layout.binDirectory} failed their health check; the previous links were restored.`,
      { executable },
    );
  }
  return settleActivation(layout, record.activationId, "active");
}

/**
 * For a `pending` record, each link may be at its previous or its new target (a crash can stop
 * between two renames); only links at the new target need restoring. Null when a link is at
 * neither, which means something else moved it since.
 */
export function unfinishedRestore(
  record: HostActivationRecord,
  current: ReadonlyMap<string, string | null>,
): HostLinkChange[] | null {
  const restore: HostLinkChange[] = [];
  for (const change of record.links) {
    const now = current.get(change.name) ?? null;
    if (now === change.previous) continue;
    if (now !== change.current) return null;
    restore.push({ ...change, previous: change.current, current: change.previous });
  }
  return restore;
}

/** Whether a record is pending and no record after it has settled, so its crash is the newest. */
export function isUnfinished(
  journal: readonly HostActivationRecord[],
  record: HostActivationRecord,
): boolean {
  const index = journal.indexOf(record);
  return (
    record.outcome === "pending" &&
    journal.slice(index + 1).every((later) => later.outcome === "pending")
  );
}

/**
 * Settles every `pending` record left by a crashed run, under the host upgrade lock where no other
 * run can own one. Only a pending record newer than every settled record is restored: its links
 * go back and it becomes `restored`. Any other pending record becomes `abandoned` without touching
 * links, as does one whose links something else moved since, so a later activation that happens to
 * install the same targets can never be undone by an old crash record.
 */
export async function reconcilePendingActivations(layout: HostUpgradeLayout): Promise<string[]> {
  const reconciled: string[] = [];
  const journal = await readActivationJournal(layout);
  const pending = journal.filter((record) => record.outcome === "pending").reverse();
  for (const record of pending) {
    const current = await readHostLinks(layout);
    const restore = isUnfinished(journal, record) ? unfinishedRestore(record, current) : null;
    if (restore === null) {
      await settleActivation(layout, record.activationId, "abandoned");
      reconciled.push(record.activationId);
      continue;
    }
    if (restore.length > 0)
      await switchHostLinks(layout, targetsOf(restore, "current"), targetsOf(restore, "previous"));
    await settleActivation(layout, record.activationId, "restored");
    reconciled.push(record.activationId);
  }
  return reconciled;
}
