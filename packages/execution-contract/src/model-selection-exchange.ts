import {
  parseModelSelection,
  readModelSelection,
  replaceModelSelection,
  serializedModelSelection,
  type ModelSelection,
} from "./model-selection.js";

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
    JSON.stringify(serializedModelSelection(candidate)) >
    JSON.stringify(serializedModelSelection(current))
  );
}

/**
 * ADR-0612 M3: adopts a selection another host published when it is newer than this host's. The
 * adopted record keeps its revision and change time, so the hosts converge and never adopt each
 * other's copy back. An unusable local file is never overwritten.
 */
export async function adoptModelSelection(input: {
  stateDirectory: string;
  candidate: unknown;
}): Promise<{ status: "adopted"; selection: ModelSelection } | { status: "current" | "rejected" }> {
  let candidate: ModelSelection;
  try {
    candidate = parseModelSelection(input.candidate);
  } catch {
    return { status: "rejected" };
  }
  const current = await readModelSelection(input.stateDirectory);
  if (current.issue !== null) return { status: "rejected" };
  if (!isNewerModelSelection(candidate, current.selection)) return { status: "current" };
  await replaceModelSelection(input.stateDirectory, current.selection.revision, candidate);
  return { status: "adopted", selection: candidate };
}
