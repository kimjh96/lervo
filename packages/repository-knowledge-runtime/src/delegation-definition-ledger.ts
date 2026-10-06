import { resolve } from "node:path";

import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

/**
 * ADR-0477 host-local record of the definition files Lervo installed. A file is Lervo-managed only
 * while its bytes still hash to an entry for its path; any edit makes it user-owned again, and a
 * file without an entry was never Lervo's. Entries are written before the install, so a crash
 * leaves at most an entry no file matches. The ledger is bounded and never replicates.
 */
export const CONVERGENCE_INSTALLED_DEFINITIONS_PATH =
  ".lervo/state/knowledge/convergence-installed-definitions.json";

const MAXIMUM_ENTRIES = 128;
const MAXIMUM_LEDGER_BYTES = 64 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/u;

export interface InstalledDefinitionEntry {
  path: string;
  /** `sha256` of the exact installed file bytes. */
  fileHash: string;
  installedAt: string;
}

interface InstalledDefinitionLedger {
  schemaVersion: 1;
  entries: InstalledDefinitionEntry[];
}

function valid(value: unknown): value is InstalledDefinitionLedger {
  const ledger = value as Partial<InstalledDefinitionLedger> | null;
  return (
    ledger !== null &&
    typeof ledger === "object" &&
    ledger.schemaVersion === 1 &&
    Array.isArray(ledger.entries) &&
    ledger.entries.every(
      (entry) =>
        typeof entry?.path === "string" &&
        typeof entry.fileHash === "string" &&
        HASH.test(entry.fileHash) &&
        typeof entry.installedAt === "string",
    )
  );
}

/** An unreadable ledger proves no ownership, so every existing file stays user-owned. */
export async function readInstalledDefinitions(root: string): Promise<InstalledDefinitionEntry[]> {
  const file = await readPrivateJsonFile(
    resolve(root, CONVERGENCE_INSTALLED_DEFINITIONS_PATH),
    MAXIMUM_LEDGER_BYTES,
  );
  return file.status === "read" && valid(file.value) ? file.value.entries : [];
}

export function lervoManagedDefinition(
  entries: readonly InstalledDefinitionEntry[],
  path: string,
  fileHash: string,
): boolean {
  return entries.some((entry) => entry.path === path && entry.fileHash === fileHash);
}

/** Newest first; an identical path and hash keeps one entry. */
export async function recordInstalledDefinitions(
  root: string,
  installed: readonly InstalledDefinitionEntry[],
): Promise<void> {
  const current = await readInstalledDefinitions(root);
  const key = (entry: InstalledDefinitionEntry) => `${entry.path}\0${entry.fileHash}`;
  const fresh = new Set(installed.map(key));
  await writePrivateJsonFile(resolve(root, CONVERGENCE_INSTALLED_DEFINITIONS_PATH), {
    schemaVersion: 1,
    entries: [...installed, ...current.filter((entry) => !fresh.has(key(entry)))].slice(
      0,
      MAXIMUM_ENTRIES,
    ),
  } satisfies InstalledDefinitionLedger);
}
