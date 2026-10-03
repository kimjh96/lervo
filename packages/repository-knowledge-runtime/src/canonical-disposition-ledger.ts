import { canonicalJson, sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";
import type { CanonicalBatch } from "./canonical-review.js";
import type { CanonicalAssessment } from "./canonical-assessment-contract.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";

type Decision = CanonicalAssessment["decisions"][number];

/** Exact source bytes settled by an independently approved, integrated canonical effect. */
export interface SettledCanonicalDisposition {
  path: string;
  contentHash: string;
  disposition: "no_change" | "covered" | "candidate" | "integrated_draft";
  eventId: string;
}

interface LedgerEntry extends SettledCanonicalDisposition {
  projectId: string;
  policyHash: string;
  references: Decision["canonicalReferences"];
  /** Integrated drafts only: the exact target bytes the draft replaced. */
  beforeHash?: string | null;
}

const ledgers = new WeakMap<OutboxStore, { afterSeq: number; entries: Map<string, LedgerEntry> }>();
const key = (path: string, contentHash: string) => `${path}\0${contentHash}`;

async function integratedInput(
  artifacts: ArtifactStore,
  hash: unknown,
): Promise<KnowledgeConvergenceInput | null> {
  if (typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(hash)) return null;
  try {
    const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
    if (sha256(bytes) !== hash) return null;
    return JSON.parse(
      new TextDecoder("utf8", { fatal: true }).decode(bytes),
    ) as KnowledgeConvergenceInput;
  } catch {
    // Retention may drop private stage inputs; the source then simply needs fresh assessment.
    return null;
  }
}

/**
 * Integrated approvals outlive the snapshot that produced them. A later baseline excludes exact
 * source bytes already settled, so supersession costs only unfinished work.
 */
async function canonicalDispositionLedger(
  events: OutboxStore,
  artifacts: ArtifactStore,
): Promise<Map<string, LedgerEntry>> {
  const ledger = ledgers.get(events) ?? { afterSeq: 0, entries: new Map<string, LedgerEntry>() };
  for (;;) {
    const page = events.list({ afterSeq: ledger.afterSeq, limit: 1_000 });
    if (!page.length) break;
    for (const event of page) {
      ledger.afterSeq = event.seq;
      if (
        event.type !== "repository.knowledge.stage.recorded" ||
        event.payload.stage !== "canonical_integration" ||
        event.payload.state !== "current"
      )
        continue;
      const prior = await integratedInput(artifacts, event.payload.inputArtifactHash);
      const batch = prior?.stageData.canonicalBatch as CanonicalBatch | null | undefined;
      const approval = prior?.stageData.canonicalApproval as {
        assessmentHash?: string;
        decision?: string;
        sourceHashes?: string[];
        draftHashes?: string[];
        reviewerAgentId?: string;
        policyHash?: string;
      } | null;
      if (
        !prior ||
        !batch ||
        !approval ||
        prior.obligationId !== event.payload.obligationId ||
        prior.baseline.projectId !== event.projectId ||
        approval.decision !== "approve" ||
        approval.assessmentHash !== sha256(canonicalJson(batch.assessment)) ||
        canonicalJson(approval.sourceHashes) !==
          canonicalJson(batch.sources.map((source) => source.contentHash)) ||
        canonicalJson(approval.draftHashes) !==
          canonicalJson(batch.assessment.drafts.map((draft) => sha256(draft.content))) ||
        !approval.reviewerAgentId ||
        approval.reviewerAgentId === batch.generatorAgentId ||
        approval.policyHash !== prior.baseline.policyHash
      )
        continue;
      for (const decision of batch.assessment.decisions) {
        if (decision.disposition === "needs_review") continue;
        const source = batch.sources.find((item) => item.path === decision.path);
        if (source?.contentHash !== decision.contentHash) continue;
        ledger.entries.set(key(decision.path, decision.contentHash), {
          path: decision.path,
          contentHash: decision.contentHash,
          disposition: decision.disposition,
          eventId: event.eventId,
          projectId: event.projectId,
          policyHash: approval.policyHash,
          references: decision.canonicalReferences,
        });
      }
      // An integrated draft is reviewed canonical output; assessing its own bytes is circular.
      for (const draft of batch.assessment.drafts) {
        const contentHash = sha256(draft.content);
        ledger.entries.set(key(draft.path, contentHash), {
          path: draft.path,
          contentHash,
          disposition: "integrated_draft",
          eventId: event.eventId,
          projectId: event.projectId,
          policyHash: approval.policyHash,
          references: [],
          beforeHash: draft.beforeHash,
        });
      }
    }
  }
  ledgers.set(events, ledger);
  return ledger.entries;
}

/** Coverage stays settled while every quoted canonical passage still exists in current bytes. */
function referencesCurrent(root: string, references: Decision["canonicalReferences"]): boolean {
  const documents = new Map<string, string | null>();
  return references.every((reference) => {
    if (!documents.has(reference.path))
      try {
        documents.set(
          reference.path,
          new TextDecoder("utf8", { fatal: true }).decode(
            ordinaryConvergenceSourceBytes(root, reference.path),
          ),
        );
      } catch {
        documents.set(reference.path, null);
      }
    return documents.get(reference.path)?.includes(reference.quote) === true;
  });
}

/** Return the exact current sources whose semantic disposition is already integrated. */
export async function settledCanonicalDispositions(input: {
  repositoryRoot: string;
  events: OutboxStore;
  artifacts: ArtifactStore;
  projectId: string;
  policyHash: string;
  sources: readonly { path: string; contentHash: string }[];
}): Promise<SettledCanonicalDisposition[]> {
  const ledger = await canonicalDispositionLedger(input.events, input.artifacts);
  return input.sources.flatMap((source) => {
    const entry = ledger.get(key(source.path, source.contentHash));
    if (
      !entry ||
      entry.projectId !== input.projectId ||
      entry.policyHash !== input.policyHash ||
      (entry.disposition === "covered" &&
        !referencesCurrent(input.repositoryRoot, entry.references))
    )
      return [];
    return [
      {
        path: entry.path,
        contentHash: entry.contentHash,
        disposition: entry.disposition,
        eventId: entry.eventId,
      },
    ];
  });
}

/**
 * Drafts whose integration settled `current`, including root apply, keyed by exact
 * `(path, contentHash)` and mapped to the target bytes they replaced.
 */
export async function integratedCanonicalDrafts(
  events: OutboxStore,
  artifacts: ArtifactStore,
): Promise<Map<string, string | null>> {
  const ledger = await canonicalDispositionLedger(events, artifacts);
  return new Map(
    [...ledger.entries()]
      .filter(([, entry]) => entry.disposition === "integrated_draft")
      .map(([entryKey, entry]) => [entryKey, entry.beforeHash ?? null]),
  );
}

export const canonicalDraftKey = key;
