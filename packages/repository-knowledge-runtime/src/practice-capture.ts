import { disclosePracticeWork } from "./practice-disclosure.js";
import { canonicalJson, sanitizePracticeText, sha256 } from "@lervo/repository-knowledge";
import type { ProviderJsonUsage } from "@lervo/repository-knowledge-compiler";
import type { InstructionCaptureContext } from "./instruction-capture-assessment.js";
import { boundedUtf8Tail, type QueuedInstructionCapture } from "./instruction-capture-queue.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { readPracticeState, writePracticeState } from "./practice-store.js";
import { loadPracticeCatalog } from "./practice-catalog.js";
import {
  reservePracticeBudget,
  settlePracticeBudget,
  type PracticeReservation,
} from "./practice-budget.js";
import { settlePracticeAssessment } from "./practice-assessment.js";

export interface PracticeCaptureAttachment {
  workDigest: string;
  data: unknown;
  validateDisclosure?(): Promise<boolean>;
  readRoots: string[];
  readablePaths: string[];
  reservation: PracticeReservation;
  ownerResponse?: { digest: string; excerpt: string };
}

export async function preparePracticeCapture(
  context: InstructionCaptureContext,
  capture: QueuedInstructionCapture,
): Promise<PracticeCaptureAttachment | null> {
  if (
    capture.source !== "terminal_prompt" ||
    (context.providerQuantum !== undefined && context.providerQuantum.remaining <= 0)
  )
    return null;
  const root = context.storage.paths.repositoryRoot;
  const state = await readPracticeState(root);
  if (!state.works.length) return null;
  const matches: Array<{ session: string; seq: number }> = [];
  let afterSeq = 0;
  while (true) {
    // ADR-0554: a typed read costs only prepared terminal contexts, never the length of history.
    const events = context.storage.events.list({
      afterSeq,
      limit: 1000,
      types: ["terminal.context.prepared"],
    });
    if (!events.length) break;
    for (const event of events)
      if (
        event.type === "terminal.context.prepared" &&
        event.payload.requestDigest === capture.promptDigest &&
        event.actor.provider === capture.provider &&
        Math.abs(Date.parse(event.occurredAt) - Date.parse(capture.enqueuedAt)) < 120_000 &&
        typeof event.payload.providerSessionDigest === "string"
      )
        matches.push({ session: event.payload.providerSessionDigest, seq: event.seq });
    afterSeq = events.at(-1)!.seq;
  }
  // The legacy capture queue has no session coordinate. Ambiguity must not join unrelated work.
  if (matches.length !== 1) return null;
  const work = state.works
    .filter(
      (w) =>
        w.sessionDigest === matches[0]!.session &&
        Date.parse(w.observedAt) <= Date.parse(capture.enqueuedAt) &&
        !state.assessed.some((a) => a.workDigest === w.workDigest),
    )
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
  if (!work) return null;
  const loaded = await loadConvergenceDelegation(root);
  if (!loaded) return null;
  const catalog = await loadPracticeCatalog(root, loaded.delegation, state);
  const data = disclosePracticeWork(work, catalog.readRoots, catalog.readablePaths);
  const inputBytes = Buffer.byteLength(canonicalJson(data));
  if (inputBytes > 24 * 1024) return null;
  const reservation = await reservePracticeBudget({
    projectId: context.storage.manifest.projectId,
    kind: "capture",
    inputBytes,
    outputTokens: 4096,
    now: context.now(),
    ...(context.admissionDirectory === undefined ? {} : { directory: context.admissionDirectory }),
  });
  return reservation
    ? {
        workDigest: work.workDigest,
        data,
        validateDisclosure: async () => {
          const current = await loadConvergenceDelegation(root);
          if (!current) return false;
          const permissions = await loadPracticeCatalog(root, current.delegation, state);
          return (
            canonicalJson(
              disclosePracticeWork(data, permissions.readRoots, permissions.readablePaths),
            ) === canonicalJson(data)
          );
        },
        readRoots: catalog.readRoots,
        readablePaths: catalog.readablePaths,
        reservation,
        ownerResponse: {
          digest: sha256(capture.ownerTurn),
          excerpt: boundedUtf8Tail(sanitizePracticeText(capture.ownerTurn), 2048),
        },
      }
    : null;
}

/** Separate parsing and persistence keep practice failures out of rule capture. */
export async function completePracticeCapture(
  context: InstructionCaptureContext,
  attachment: PracticeCaptureAttachment,
  value: unknown,
  usage: ProviderJsonUsage | null,
): Promise<void> {
  if (attachment.validateDisclosure && !(await attachment.validateDisclosure())) {
    await settlePracticeBudget(attachment.reservation, usage?.totalTokens ?? null);
    return;
  }
  const state = await readPracticeState(context.storage.paths.repositoryRoot);
  const work = state.works.find((w) => w.workDigest === attachment.workDigest);
  const practice = (value as { practice?: unknown } | null)?.practice;
  await settlePracticeBudget(
    attachment.reservation,
    usage === null
      ? null
      : Math.min(
          usage.totalTokens,
          Buffer.byteLength(canonicalJson(attachment.data)) +
            Buffer.byteLength(canonicalJson(practice ?? null)),
        ),
  );
  if (work)
    await settlePracticeAssessment({
      context,
      state,
      work,
      value: practice,
      readRoots: attachment.readRoots,
      readablePaths: attachment.readablePaths,
      ...(attachment.ownerResponse === undefined
        ? {}
        : { ownerResponse: attachment.ownerResponse }),
    });
  await writePracticeState(context.storage.paths.repositoryRoot, state, context.now());
}
