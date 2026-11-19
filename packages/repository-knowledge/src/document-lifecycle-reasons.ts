import type { DocumentLifecycleGitPort } from "./document-lifecycle-git.js";
import {
  evaluateDocumentLifecycleGroup,
  unknownCatalogCommands,
} from "./document-lifecycle-group.js";
import type { DocumentLifecycleEvidence } from "./document-lifecycle-model.js";
import type { DocumentLifecycleRecord } from "./document-lifecycle-record.js";
import type { RelationWeb } from "./relation-web.js";

export interface DocumentLifecycleReasons {
  /** Resolved reasons per evaluated document; absent means nothing it names changed. */
  found: Map<string, DocumentLifecycleEvidence[]>;
  /** Documents whose baseline Git could not diff, such as a rewritten commit; swept again. */
  unavailable: Set<string>;
  /** Documents whose recorded reasons were reused because no change reached them. */
  reused: Set<string>;
  /** Command mentions the catalog does not know now, for the next record. */
  unknownCommands: string[];
  /** Documents whose group did not fit this call's budget; a later call evaluates them. */
  deferred: Set<string>;
}

/** Per-call bound on diff groups and wall time, so one call never runs unbounded. */
export interface DocumentLifecycleBudget {
  maximumGroups: number;
  /** Epoch milliseconds after which no further group starts. */
  deadline: number;
  clock: () => number;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Computes the open reasons of every document with a baseline, with as few diffs as possible:
 *
 * - Documents assessed through the record's revision form one group over the change since then.
 *   Commands count as removed only when they became unknown since then.
 * - A document left open at an older baseline reuses its recorded reasons unless that same change
 *   reaches it; then it is evaluated again from its own baseline.
 * - A document with a fresh baseline (swept by the cadence or edited since its assessment) is
 *   evaluated from its own last commit. Every command unknown now counts as removed for it.
 */
export async function findDocumentLifecycleReasons(input: {
  web: RelationWeb;
  git: DocumentLifecycleGitPort;
  head: string;
  record: DocumentLifecycleRecord;
  /** Document → the revision its reasons are computed from; documents at HEAD are omitted. */
  baselines: ReadonlyMap<string, string>;
  /** Documents whose baseline is their own last commit rather than a recorded assessment. */
  fresh: ReadonlySet<string>;
  readDocument: (path: string) => Promise<string | null>;
  budget: DocumentLifecycleBudget;
}): Promise<DocumentLifecycleReasons> {
  const { web, git, head, record, budget } = input;
  let started = 0;
  const admit = () => {
    if (started >= budget.maximumGroups || budget.clock() >= budget.deadline) return false;
    started += 1;
    return true;
  };
  const deferred = new Set<string>();
  const unknownCommands = unknownCatalogCommands(web);
  const knownUnknown = new Set(record.unknownCommands);
  const found = new Map<string, DocumentLifecycleEvidence[]>();
  const unavailable = new Set<string>();
  const reused = new Set<string>();
  const groups = new Map<string, string[]>();
  const addToGroup = (baseline: string, path: string) =>
    groups.set(baseline, [...(groups.get(baseline) ?? []), path]);

  const since = record.revision;
  const main: string[] = [];
  const pending: string[] = [];
  for (const [path, baseline] of input.baselines) {
    if (baseline === head) continue;
    if (input.fresh.has(path)) addToGroup(baseline, path);
    else if (baseline === since) main.push(path);
    else pending.push(path);
  }
  let reached: ReadonlySet<string> | null = since === head ? new Set() : null;
  if (since !== null && since !== head && main.length + pending.length > 0 && !admit()) {
    // Without the shared diff, recorded documents wait for a later call; nothing is reused.
    for (const path of main) deferred.add(path);
    for (const path of pending) deferred.add(path);
    pending.length = 0;
  } else if (since !== null && since !== head && main.length + pending.length > 0) {
    try {
      const result = await evaluateDocumentLifecycleGroup({
        web,
        git,
        head,
        group: { baseline: since, documents: [...main, ...pending] },
        unknownCommands: unknownCommands.filter((command) => !knownUnknown.has(command)),
        readDocument: input.readDocument,
      });
      for (const path of main) {
        const reasons = result.get(path);
        if (reasons !== undefined) found.set(path, reasons);
      }
      reached = new Set(result.keys());
    } catch {
      // The record's revision is gone, such as after a rewrite; these documents are swept again.
      for (const path of main) unavailable.add(path);
    }
  }
  for (const path of pending) {
    const cached = record.documents[path]?.reasons;
    if (reached !== null && !reached.has(path) && cached !== undefined) {
      found.set(path, cached);
      reused.add(path);
    } else addToGroup(input.baselines.get(path)!, path);
  }
  for (const [baseline, paths] of [...groups].sort(([left], [right]) => compare(left, right))) {
    if (!admit()) {
      for (const path of paths) deferred.add(path);
      continue;
    }
    try {
      const result = await evaluateDocumentLifecycleGroup({
        web,
        git,
        head,
        group: { baseline, documents: paths },
        unknownCommands,
        readDocument: input.readDocument,
      });
      for (const [path, evidence] of result) found.set(path, evidence);
    } catch {
      for (const path of paths) unavailable.add(path);
    }
  }
  return { found, unavailable, reused, unknownCommands, deferred };
}
