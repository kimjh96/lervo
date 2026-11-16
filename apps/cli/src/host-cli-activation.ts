import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { CommandFailure } from "./command-error-output.js";
import { HOST_CLI_LINKS, type HostUpgradeLayout } from "./host-upgrade-layout.js";

/**
 * ADR-0571: one activation switches every executable link of a host to one installed package and
 * is recorded under an activation id, so `--rollback <id>` can restore exactly the links it
 * replaced. The record is written as `pending` before any link moves, so a crash mid-switch still
 * leaves an id to roll back. The journal keeps the newest records only; it is a bounded
 * projection, not history.
 */
export const HOST_ACTIVATION_JOURNAL_LIMIT = 8;

export interface HostLinkChange {
  name: string;
  path: string;
  previous: string | null;
  current: string | null;
}

/** `pending` until the health check passes; `restored` when it failed and links went back. */
export type HostActivationOutcome = "pending" | "active" | "restored";

export interface HostActivationRecord {
  activationId: string;
  kind: "release" | "rollback";
  outcome: HostActivationOutcome;
  activatedAt: string;
  links: HostLinkChange[];
  release?: {
    repository: string;
    tag: string;
    version: string;
    commit: string;
    tree: string;
    tarballSha256: string;
    installDirectory: string;
    downloadDirectory: string;
  };
  rolledBackActivationId?: string;
}

interface HostActivationJournal {
  schemaVersion: 1;
  activations: HostActivationRecord[];
}

export type HostLinkState =
  | { name: string; path: string; state: "absent"; target: null }
  | { name: string; path: string; state: "link"; target: string }
  | { name: string; path: string; state: "unmanaged"; target: null };

/** Every executable link as it is now, without failing on a user-owned file. */
export async function inspectHostLinks(layout: HostUpgradeLayout): Promise<HostLinkState[]> {
  const states: HostLinkState[] = [];
  for (const { name } of HOST_CLI_LINKS) {
    const path = resolve(layout.binDirectory, name);
    const metadata = await lstat(path).catch(() => null);
    if (metadata === null) states.push({ name, path, state: "absent", target: null });
    else if (!metadata.isSymbolicLink())
      states.push({ name, path, state: "unmanaged", target: null });
    else states.push({ name, path, state: "link", target: await readlink(path) });
  }
  return states;
}

/** The current target of each executable link, or null when the link does not exist. */
export async function readHostLinks(
  layout: HostUpgradeLayout,
): Promise<Map<string, string | null>> {
  const links = new Map<string, string | null>();
  for (const link of await inspectHostLinks(layout)) {
    if (link.state === "unmanaged")
      throw new CommandFailure(
        "host_upgrade_link_not_managed",
        `${link.path} is not a symbolic link; Lervo never replaces a user-owned file. Move it away or pass --bin-directory.`,
        { path: link.path },
      );
    links.set(link.name, link.target);
  }
  return links;
}

/** The link targets that activate one installed package root. */
export function packageLinkTargets(packageRoot: string): Map<string, string> {
  return new Map(HOST_CLI_LINKS.map((link) => [link.name, resolve(packageRoot, link.target)]));
}

async function switchLinks(
  layout: HostUpgradeLayout,
  targets: ReadonlyMap<string, string | null>,
): Promise<void> {
  await mkdir(layout.binDirectory, { recursive: true });
  for (const [name, target] of targets) {
    const path = resolve(layout.binDirectory, name);
    if (target === null) {
      await rm(path, { force: true });
      continue;
    }
    const temporary = resolve(layout.binDirectory, `.${name}-${randomUUID()}`);
    try {
      await symlink(target, temporary);
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

/**
 * Points each named link at its target, or removes it for null; each swap is one rename. When a
 * swap fails partway, the links already moved go back to `restore` before the failure is raised.
 */
export async function switchHostLinks(
  layout: HostUpgradeLayout,
  targets: ReadonlyMap<string, string | null>,
  restore: ReadonlyMap<string, string | null>,
): Promise<void> {
  try {
    await switchLinks(layout, targets);
  } catch (error) {
    await switchLinks(layout, restore).catch(() => undefined);
    throw new CommandFailure(
      "host_upgrade_switch_failed",
      `Switching the executable links in ${layout.binDirectory} failed (${(error as NodeJS.ErrnoException).code ?? "unknown"}); the previous links were restored.`,
    );
  }
}

function journalInvalid(layout: HostUpgradeLayout): CommandFailure {
  return new CommandFailure(
    "host_upgrade_journal_invalid",
    `The host activation journal ${layout.journalPath} is unreadable; it was left untouched.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validRecord(value: unknown): value is HostActivationRecord {
  return (
    isRecord(value) &&
    typeof value.activationId === "string" &&
    (value.kind === "release" || value.kind === "rollback") &&
    (value.outcome === "pending" || value.outcome === "active" || value.outcome === "restored") &&
    typeof value.activatedAt === "string" &&
    Array.isArray(value.links) &&
    value.links.every(
      (change: unknown) =>
        isRecord(change) &&
        typeof change.name === "string" &&
        typeof change.path === "string" &&
        (change.previous === null || typeof change.previous === "string") &&
        (change.current === null || typeof change.current === "string"),
    )
  );
}

export async function readActivationJournal(
  layout: HostUpgradeLayout,
): Promise<HostActivationRecord[]> {
  let contents: string;
  try {
    contents = await readFile(layout.journalPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let journal: unknown;
  try {
    journal = JSON.parse(contents);
  } catch {
    throw journalInvalid(layout);
  }
  if (
    !isRecord(journal) ||
    journal.schemaVersion !== 1 ||
    !Array.isArray(journal.activations) ||
    !journal.activations.every(validRecord)
  )
    throw journalInvalid(layout);
  return journal.activations;
}

async function writeJournal(
  layout: HostUpgradeLayout,
  activations: HostActivationRecord[],
): Promise<void> {
  const journal: HostActivationJournal = { schemaVersion: 1, activations };
  await mkdir(layout.cliDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${layout.journalPath}.${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600, flush: true });
  await rename(temporary, layout.journalPath);
}

/** Appends one record and keeps only the newest records, replacing the journal atomically. */
export async function recordActivation(
  layout: HostUpgradeLayout,
  record: HostActivationRecord,
): Promise<HostActivationRecord[]> {
  const activations = [...(await readActivationJournal(layout)), record].slice(
    -HOST_ACTIVATION_JOURNAL_LIMIT,
  );
  await writeJournal(layout, activations);
  return activations;
}

/** Sets the outcome of one retained record. */
export async function settleActivation(
  layout: HostUpgradeLayout,
  activationId: string,
  outcome: HostActivationOutcome,
): Promise<HostActivationRecord[]> {
  const activations = (await readActivationJournal(layout)).map((record) =>
    record.activationId === activationId ? { ...record, outcome } : record,
  );
  await writeJournal(layout, activations);
  return activations;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const readLockHolder = async (path: string): Promise<number | null> => {
  const holder = Number.parseInt(await readFile(path, "utf8").catch(() => ""), 10);
  return Number.isSafeInteger(holder) && holder > 0 ? holder : null;
};

/**
 * The lock appears with its holder's pid already inside: the pid is written to a private file
 * that is then hard-linked into place, which fails if a lock exists. A dead holder's lock is
 * renamed away to a unique name before it is judged, so two runs never both take it over.
 */
async function acquireHostUpgradeLock(layout: HostUpgradeLayout): Promise<string> {
  await mkdir(layout.cliDirectory, { recursive: true, mode: 0o700 });
  const token = `${process.pid}\n${randomUUID()}\n`;
  const candidate = `${layout.lockPath}.${randomUUID()}`;
  await writeFile(candidate, token, { mode: 0o600 });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await link(candidate, layout.lockPath);
        return token;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const holder = await readLockHolder(layout.lockPath);
      if (holder !== null && processIsAlive(holder))
        throw new CommandFailure(
          "host_upgrade_in_progress",
          `Another host upgrade (process ${holder}) is running on this host; nothing was changed. If no Lervo process ${holder} exists, remove ${layout.lockPath}.`,
          { pid: holder, lock: layout.lockPath },
        );
      const stale = `${layout.lockPath}.stale-${randomUUID()}`;
      await rename(layout.lockPath, stale).catch(() => undefined);
      const movedHolder = await readLockHolder(stale);
      if (movedHolder !== null && processIsAlive(movedHolder)) {
        // A live run took the lock between the read and the rename; give it back.
        await link(stale, layout.lockPath).catch(() => undefined);
      }
      await rm(stale, { force: true });
    }
  } finally {
    await rm(candidate, { force: true });
  }
  throw new CommandFailure(
    "host_upgrade_in_progress",
    "Another host upgrade took the lock first; nothing was changed.",
  );
}

/**
 * Runs one host upgrade or rollback at a time per host. The lock is removed only while it still
 * holds this run's token.
 */
export async function withHostUpgradeLock<T>(
  layout: HostUpgradeLayout,
  operation: () => Promise<T>,
): Promise<T> {
  const token = await acquireHostUpgradeLock(layout);
  try {
    return await operation();
  } finally {
    if ((await readFile(layout.lockPath, "utf8").catch(() => "")) === token)
      await rm(layout.lockPath, { force: true });
  }
}
