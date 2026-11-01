import { openProjectStorage } from "@lervo/project-storage";
import {
  createDurableInstructionCandidate,
  createDurableInstructionPlan,
  durableInstructionCatalogDigest,
  sha256,
  storeDurableInstructionCandidate,
  type DurableInstructionCandidateInspection,
  type DurableInstructionPlan,
} from "@lervo/repository-knowledge";

import { groundDurableInstructionRequest } from "./durable-instruction-grounding.js";
import { inspectInstructionCatalog } from "./instruction-catalog.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliServices } from "./types.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

export function catalogDigest(
  catalog: Awaited<ReturnType<typeof inspectInstructionCatalog>>,
): string {
  return durableInstructionCatalogDigest(catalog.semanticCatalog.canonicalInstructions.entries);
}

export interface DurableInstructionIntakeResult {
  schemaVersion: 1;
  status: DurableInstructionPlan["status"] | "review_required";
  planId: string;
  reasonIds: string[];
  candidate: DurableInstructionCandidateInspection | null;
}

export async function intakeDurableInstruction(input: {
  repositoryRoot: string;
  provider: "codex" | "claude";
  request: string;
  now: Date;
  services: Pick<CliServices, "groundProductionRequest">;
}): Promise<DurableInstructionIntakeResult> {
  const supplementalSources = await collectLocalKnowledgeSources(input.repositoryRoot);
  const catalog = await inspectInstructionCatalog({
    repositoryRoot: input.repositoryRoot,
    supplementalSources,
  });
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const currentWorkstream = await verifiedCurrentWorkstream(storage);
    const grounding = await groundDurableInstructionRequest({
      request: input.request,
      provider: input.provider,
      currentWorkstream:
        currentWorkstream === null
          ? null
          : {
              workstreamId: currentWorkstream.workstreamId,
              revision: currentWorkstream.revision,
            },
      semanticCatalog: catalog.semanticCatalog,
      services: input.services,
    });
    const plan = await createDurableInstructionPlan({
      repositoryRoot: input.repositoryRoot,
      projectId: storage.manifest.projectId,
      requestDigest: sha256(input.request),
      resolverResultDigest: grounding.resolverResultDigest,
      groundingStatus: grounding.status,
      catalogComplete:
        catalog.complete && catalog.semanticCatalog.canonicalInstructions.entries.length < 32,
      ambiguityReasons: grounding.ambiguityReasons,
      instruction: grounding.durableInstruction,
    });
    if (plan.status !== "ready") {
      return {
        schemaVersion: 1,
        status: plan.status,
        planId: plan.planId,
        reasonIds: plan.reasonIds,
        candidate: null,
      };
    }
    const candidate = await storeDurableInstructionCandidate({
      repositoryRoot: input.repositoryRoot,
      candidate: createDurableInstructionCandidate({
        plan,
        provider: input.provider,
        sourceSnapshotId: catalog.sourceSnapshotId,
        instruction: grounding.durableInstruction,
        now: input.now,
        instructionCatalogDigest: catalogDigest(catalog),
      }),
    });
    return {
      schemaVersion: 1,
      status: "review_required",
      planId: plan.planId,
      reasonIds: plan.reasonIds,
      candidate,
    };
  } finally {
    await storage.close();
  }
}
