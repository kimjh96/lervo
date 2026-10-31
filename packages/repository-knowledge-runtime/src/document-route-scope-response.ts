import type { ProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";
import type { DocumentRouteScopeProposal } from "./document-route-scope-proposal.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";

const OPERATION = "document_route_scope_decision";

/** Owner responses use the existing private CAS receipt and materialization journal. */
export async function documentRouteScopeResponse(
  storage: ProjectStorage,
  proposal: DocumentRouteScopeProposal,
): Promise<"accept" | "decline" | null> {
  let response: "accept" | "decline" | null = null;
  for (let afterSeq = 0; ;) {
    const page = storage.events.list({
      afterSeq,
      limit: 512,
      types: ["knowledge.materialization.applied"],
    });
    if (page.length === 0) return response;
    for (const event of page) {
      afterSeq = event.seq;
      if (event.payload.operation !== OPERATION || event.payload.planId !== proposal.proposalId)
        continue;
      const hash = String(event.payload.resultArtifactHash);
      const bytes = await storage.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
      if (sha256(bytes) !== hash)
        throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
      const record = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
      if (
        record.proposal.proposalId !== proposal.proposalId ||
        (record.response !== "accept" && record.response !== "decline")
      )
        throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
      response = record.response;
    }
  }
}

/** Journal history is canonical; the continuity projection is only a current reading. */
export async function writeDocumentRouteScopeResponse(
  storage: ProjectStorage,
  input: {
    proposal: DocumentRouteScopeProposal;
    response: "accept" | "decline";
    evidenceArtifactHash: string;
    policyHash: string;
  },
): Promise<void> {
  const { proposal } = input;
  if ((await documentRouteScopeResponse(storage, proposal)) !== input.response)
    await recordConvergenceMaterialization(storage, {
      operation: OPERATION,
      planId: proposal.proposalId,
      sourceSnapshotId: proposal.planId,
      policyHash: input.policyHash,
      receipt: {
        schemaVersion: 1,
        proposal,
        response: input.response,
        evidenceArtifactHash: input.evidenceArtifactHash,
      },
      created: [],
      updated: [],
      deleted: [],
      validation: { proposalId: proposal.proposalId, response: input.response },
    });
}
