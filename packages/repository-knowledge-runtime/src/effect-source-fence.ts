import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { captureConvergenceSources } from "./source-capture.js";

export interface ConvergenceApprovedEffect {
  path: string;
  beforeHash: string | null;
  afterHash: string | null;
}

/** Own writes may advance a snapshot only at exact approved paths; unrelated concurrent edits invalidate it. */
export function assertConvergenceEffectSources(
  state: KnowledgeConvergenceInput,
  after: ReturnType<typeof captureConvergenceSources>,
  effects: readonly ConvergenceApprovedEffect[] = [],
  committedHead?: { before: string; after: string },
): void {
  if (after.snapshotHash === state.snapshotHash) return;
  const beforeCapture = state.stageData.sourceCapture as
    ReturnType<typeof captureConvergenceSources> | undefined;
  const beforeHead = beforeCapture?.head ?? state.baseline.sourceCommit;
  // Only this stage's own child commit of the observed HEAD may move it; bytes still must match.
  const ownCommit =
    committedHead !== undefined &&
    committedHead.before === beforeHead &&
    committedHead.after === after.head;
  if (beforeHead !== undefined && after.head !== beforeHead && !ownCommit)
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  const prior =
    (state.stageData.sourceCapture as ReturnType<typeof captureConvergenceSources> | undefined)
      ?.sources ?? state.baseline.sources;
  const beforeHashes = new Map(prior.map((source) => [source.path, source.contentHash]));
  const afterHashes = new Map(after.sources.map((source) => [source.path, source.contentHash]));
  const approved = new Map(effects.map((effect) => [effect.path, effect]));
  if (approved.size !== effects.length)
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  let changed = false;
  for (const path of new Set([...beforeHashes.keys(), ...afterHashes.keys()])) {
    const before = beforeHashes.get(path) ?? null;
    const current = afterHashes.get(path) ?? null;
    if (before === current) continue;
    const effect = approved.get(path);
    if (!effect || effect.beforeHash !== before || effect.afterHash !== current)
      throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
    changed = true;
  }
  // HEAD drift cannot be hidden by supplying an empty effect list.
  if (!changed && !ownCommit) throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
}

export function convergenceOperationEffects(
  operations: readonly {
    path: string;
    action: string;
    expectedCurrentHash?: string;
    desiredHash?: string;
    destinationPath?: string;
  }[],
): ConvergenceApprovedEffect[] {
  const effects: ConvergenceApprovedEffect[] = [];
  for (const operation of operations) {
    if (operation.action === "unchanged") continue;
    if (operation.action === "move" || operation.action === "move_update") {
      effects.push({
        path: operation.path,
        beforeHash: operation.expectedCurrentHash ?? null,
        afterHash: null,
      });
      effects.push({
        path: operation.destinationPath!,
        beforeHash: null,
        afterHash: operation.desiredHash ?? operation.expectedCurrentHash ?? null,
      });
    } else
      effects.push({
        path: operation.path,
        beforeHash: operation.expectedCurrentHash ?? null,
        afterHash: operation.action === "delete" ? null : (operation.desiredHash ?? null),
      });
  }
  return effects;
}
