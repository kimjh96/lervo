import type { ArtifactStore, OutboxDelivery, OutboxStore } from "@lervo/storage-contract";

import {
  readLeasedConversationKnowledgeJob,
  type LeasedConversationKnowledgeJob,
} from "./conversation-knowledge-lease.js";
import { readConversationKnowledgeJobSource } from "./conversation-knowledge-job-source.js";
import {
  inspectRepositoryWorkSourceCurrency,
  type RepositoryWorkSourceCurrency,
} from "./repository-work-source-currency.js";
import type { RepositoryWorkSourceManifest } from "./repository-work-source-manifest.js";

export type LeasedConversationKnowledgeSource =
  | {
      status: "ready_for_review";
      job: LeasedConversationKnowledgeJob;
      manifest: RepositoryWorkSourceManifest;
      changedPathCount: number;
    }
  | {
      status: "stale" | "needs_review";
      job: LeasedConversationKnowledgeJob;
      changedPathCount: number;
      reasonCode:
        | "legacy_source_unavailable"
        | Exclude<RepositoryWorkSourceCurrency, { status: "ready_for_review" }>["reasonCode"];
    };

/** Preflight is read-only and never claims semantic review, assignment success, or knowledge currency. */
export async function inspectLeasedConversationKnowledgeSource(input: {
  events: Pick<OutboxStore, "get" | "getOutbox">;
  artifacts: ArtifactStore;
  repositoryRoot: string;
  claimed: OutboxDelivery;
  workerId: string;
  now(): string;
}): Promise<LeasedConversationKnowledgeSource> {
  const first = readLeasedConversationKnowledgeJob({ ...input, now: input.now() });
  if (first.completion.payload.knowledgeDisposition === "baseline_valid") {
    const job = readLeasedConversationKnowledgeJob({ ...input, now: input.now() });
    return {
      status: "needs_review",
      job,
      changedPathCount: first.changedPathCount,
      reasonCode: "legacy_source_unavailable",
    };
  }
  const manifest = await readConversationKnowledgeJobSource({
    completion: first.completion,
    artifacts: input.artifacts,
  });
  const currency = await inspectRepositoryWorkSourceCurrency({
    repositoryRoot: input.repositoryRoot,
    manifest,
  });
  const job = readLeasedConversationKnowledgeJob({ ...input, now: input.now() });
  return currency.status === "ready_for_review"
    ? { status: "ready_for_review", job, manifest, changedPathCount: currency.changedPathCount }
    : { ...currency, job };
}
