import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { canonicalJson, practicePublicPath, sha256 } from "@lervo/repository-knowledge";
import type { QueuedTerminalSkillTurn } from "./terminal-skill-queue.js";
import type { readVerifiedTerminalTranscript } from "./terminal-skill-transcript.js";
import { extractPracticeSteps } from "./practice-transcript.js";
import { readPracticeState, writePracticeState } from "./practice-store.js";
import { practiceFunnel, type PracticeWorkRecord } from "./practice-state.js";

/** Canonical manifests already retain hashes of uncommitted changes at Stop. Never re-hash later bytes. */
async function changedFiles(
  storage: ProjectStorage,
  turnEventId: string,
): Promise<PracticeWorkRecord["changedFiles"] | null> {
  let afterSeq = 0;
  while (true) {
    const batch = storage.events.list({ afterSeq, limit: 1000 });
    if (!batch.length) return null;
    for (const event of batch) {
      if (
        event.type !== "repository.change.completed" ||
        event.payload.sourceEventId !== turnEventId
      )
        continue;
      const ref = event.payload.sourceManifest as { contentHash: string; byteCount: number };
      if (!ref || ref.byteCount > 1024 * 1024) return null;
      const bytes = await storage.artifacts.get(`lervo-cas://sha256/${ref.contentHash.slice(7)}`);
      if (sha256(bytes) !== ref.contentHash) return null;
      const body = JSON.parse(Buffer.from(bytes).toString("utf8")) as {
        sourceEventId: string;
        paths: PracticeWorkRecord["changedFiles"];
      };
      return body.sourceEventId === turnEventId &&
        Array.isArray(body.paths) &&
        body.paths.length <= 128
        ? body.paths
            .filter((p) => practicePublicPath(p.path))
            .map(({ path, before, after }) => ({ path, before, after }))
        : null;
    }
    afterSeq = batch.at(-1)!.seq;
  }
}

export async function observePracticeWork(input: {
  storage: ProjectStorage;
  turn: QueuedTerminalSkillTurn;
  parent: EventEnvelope;
  transcript: Awaited<ReturnType<typeof readVerifiedTerminalTranscript>>;
  now: Date;
}): Promise<void> {
  const { storage, turn, parent, transcript, now } = input;
  const root = storage.paths.repositoryRoot;
  const state = await readPracticeState(root);
  if (
    state.works.some((w) => w.contextEventId === turn.contextEventId) ||
    state.assessed.some((w) => w.workDigest === sha256(turn.contextEventId))
  )
    return;
  if (transcript.status !== "observed") {
    practiceFunnel(state, now, "observed", "source_incomplete");
    state.assessed.push({ workDigest: sha256(turn.contextEventId), at: now.toISOString() });
    await writePracticeState(root, state, now);
    return;
  }
  const extracted = extractPracticeSteps(transcript.entries, root);
  const files =
    parent.payload.repositoryChanged === false ? [] : await changedFiles(storage, turn.turnEventId);
  const before =
    typeof parent.payload.repositoryRevisionBefore === "string"
      ? parent.payload.repositoryRevisionBefore
      : null;
  const after =
    typeof parent.payload.repositoryRevisionAfter === "string"
      ? parent.payload.repositoryRevisionAfter
      : null;
  const workDigest = sha256(
    canonicalJson([
      turn.providerSessionDigest,
      turn.providerTurnDigest,
      before,
      after,
      extracted.entryIds,
    ]),
  );
  if (state.assessed.some((w) => w.workDigest === workDigest)) return;
  const complete = extracted.complete && files !== null && before !== null && after !== null;
  const work: PracticeWorkRecord = {
    workDigest,
    contextEventId: turn.contextEventId,
    turnEventId: turn.turnEventId,
    provider: turn.provider,
    sessionDigest: turn.providerSessionDigest,
    turnDigest: turn.providerTurnDigest,
    observedAt: parent.occurredAt,
    revisionBefore: before,
    revisionAfter: after,
    stopCommit: turn.repositoryRevision,
    changedFiles: files ?? [],
    reply: extracted.reply,
    steps: extracted.steps,
    outcome:
      complete &&
      extracted.steps.some((s) => s.verification && s.outcome === "passed") &&
      !extracted.steps.some((s) => s.outcome === "failed")
        ? "passed"
        : "verification_unavailable",
    complete,
  };
  while (Buffer.byteLength(canonicalJson(work)) > 24 * 1024) {
    work.complete = false;
    work.outcome = "verification_unavailable";
    if (work.steps.length) work.steps.pop();
    else if (work.changedFiles.length) work.changedFiles.pop();
    else break;
  }
  state.works.push(work);
  const shape = extracted.steps.map((s) => `${s.kind}:${s.executable ?? ""}`);
  if (!state.shapes.some((s) => s.workDigest === workDigest))
    state.shapes.push({
      workDigest,
      digest: sha256(canonicalJson(shape)),
      steps: shape,
      observedAt: work.observedAt,
    });
  practiceFunnel(state, now, "observed");
  await writePracticeState(root, state, now);
}
