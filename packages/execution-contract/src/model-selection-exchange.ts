import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  parseModelSelection,
  readModelSelection,
  replaceModelSelection,
  serializedModelSelection,
  type ModelSelection,
} from "./model-selection.js";

/**
 * How far ahead of this host's clock a peer's change time may be. A WSL clock drifts after the
 * Windows host sleeps; a change stamped further ahead is refused, so a skewed or forged stamp can
 * never win over every later local change.
 */
export const MAXIMUM_PEER_CLOCK_LEAD_MS = 10 * 60 * 1000;

export const MODEL_SELECTION_NOTICE_FILE = "model-selection-notice.json";

/** The form a host publishes to its peers: the file form, with unknown roles kept. */
export function transportedModelSelection(selection: ModelSelection): {
  schemaVersion: 1;
  revision: number;
  changedAt: string;
  roles: Record<string, unknown[]>;
} | null {
  if (selection.revision === 0 || selection.changedAt === null) return null;
  return serializedModelSelection(selection) as {
    schemaVersion: 1;
    revision: number;
    changedAt: string;
    roles: Record<string, unknown[]>;
  };
}

/** JSON with sorted keys, so two Lervo versions compare the same content the same way. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/**
 * ADR-0612 M3: whether `candidate` is newer than `current`. The later change wins; the same change
 * time falls back to the higher revision, then to the content, so two hosts always agree.
 */
export function isNewerModelSelection(candidate: ModelSelection, current: ModelSelection): boolean {
  const time = (selection: ModelSelection) =>
    selection.changedAt === null ? -Infinity : Date.parse(selection.changedAt);
  if (time(candidate) !== time(current)) return time(candidate) > time(current);
  if (candidate.revision !== current.revision) return candidate.revision > current.revision;
  return (
    canonical(serializedModelSelection(candidate)) > canonical(serializedModelSelection(current))
  );
}

/**
 * ADR-0612 M3: adopts a selection another host published when it is newer than this host's. The
 * adopted record keeps its revision and change time, so the hosts converge and never adopt each
 * other's copy back. An unusable local file is never overwritten, and a change stamped too far
 * ahead of this host's clock is refused. Each adoption leaves a notice beside the selection.
 */
export async function adoptModelSelection(input: {
  stateDirectory: string;
  candidate: unknown;
  now?: Date;
}): Promise<{ status: "adopted"; selection: ModelSelection } | { status: "current" | "rejected" }> {
  let candidate: ModelSelection;
  try {
    candidate = parseModelSelection(input.candidate);
  } catch {
    return { status: "rejected" };
  }
  const now = input.now ?? new Date();
  if (
    candidate.revision === 0 ||
    candidate.changedAt === null ||
    Date.parse(candidate.changedAt) > now.getTime() + MAXIMUM_PEER_CLOCK_LEAD_MS
  )
    return { status: "rejected" };
  const current = await readModelSelection(input.stateDirectory);
  if (current.issue !== null) return { status: "rejected" };
  if (!isNewerModelSelection(candidate, current.selection)) return { status: "current" };
  await replaceModelSelection(input.stateDirectory, current.selection, candidate);
  await writeAdoptionNotice(input.stateDirectory, {
    adoptedAt: now.toISOString(),
    previous: { revision: current.selection.revision, changedAt: current.selection.changedAt },
    adopted: { revision: candidate.revision, changedAt: candidate.changedAt },
  });
  return { status: "adopted", selection: candidate };
}

export interface ModelSelectionAdoptionNotice {
  adoptedAt: string;
  previous: { revision: number; changedAt: string | null };
  adopted: { revision: number; changedAt: string };
}

/** The last adoption, replaced by the next, so `lervo model show` can say where routes came from. */
async function writeAdoptionNotice(
  stateDirectory: string,
  notice: ModelSelectionAdoptionNotice,
): Promise<void> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const path = resolve(stateDirectory, MODEL_SELECTION_NOTICE_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, ...notice }, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}
