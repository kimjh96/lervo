import {
  semanticResolutionFailureDecision,
  type DurableInstructionIntent,
  type GroundingWorkflowDescriptor,
} from "@lervo/request-grounding";

import { GroundProductionRequestError } from "./semantic-grounding.js";
import type { CliServices } from "./types.js";

const instructionIntakeWorkflows: GroundingWorkflowDescriptor[] = [
  {
    workflowId: "knowledge.instruction.intake",
    supportedIntents: ["change", "continue"],
    supportedDispositions: ["execute"],
    effectIds: ["repository.change"],
    requiredSourceClasses: ["repository_state"],
    authority: "repository_write",
    allowedCapabilityIds: [],
    crossProviderAllowed: false,
  },
];

const failedInstruction: DurableInstructionIntent = {
  disposition: "none",
  speechAct: "other",
  authority: "inferred",
  durability: "unspecified",
  operation: "none",
  scope: { kind: "unspecified", paths: [] },
  title: null,
  statement: null,
  exceptions: [],
  risk: "unknown",
  conflict: "unknown",
  confidence: "low",
  reasonIds: ["semantic_resolution_failed"],
};

export async function groundDurableInstructionRequest(input: {
  request: string;
  provider: "codex" | "claude";
  currentWorkstream: {
    workstreamId: string;
    revision: number;
    context?: string;
  } | null;
  semanticCatalog: unknown;
  services: Pick<CliServices, "groundProductionRequest">;
}) {
  try {
    const grounded = await input.services.groundProductionRequest({
      request: input.request,
      provider: input.provider,
      resolutionContext: {
        priorTurns: [],
        currentWorkstream: input.currentWorkstream,
        pendingAuthorityIds: [],
        repositoryCondition: "current",
      },
      grantedAuthorities: ["read", "repository_write"],
      workflows: instructionIntakeWorkflows,
      semanticCatalog: input.semanticCatalog,
      timeoutMs: 10_000,
    });
    return {
      ...grounded.decision,
      ambiguityReasons: grounded.proposal.ambiguityReasons,
      resolverResultDigest: grounded.proposal.resolver.resultDigest,
      durableInstruction: grounded.proposal.durableInstruction,
    };
  } catch (error) {
    if (!(error instanceof GroundProductionRequestError)) throw error;
    return {
      ...semanticResolutionFailureDecision(),
      ambiguityReasons: ["semantic_resolution_failed"],
      resolverResultDigest: `sha256:${"0".repeat(64)}`,
      durableInstruction: failedInstruction,
    };
  }
}
