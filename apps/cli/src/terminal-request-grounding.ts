import {
  semanticResolutionFailureDecision,
  type GroundingDecision,
  type DurableInstructionIntent,
  type GroundingWorkflowDescriptor,
} from "@lervo/request-grounding";

import { GroundProductionRequestError } from "./semantic-grounding.js";
import type { RunProvider } from "./managed-run.js";
import type { CliServices } from "./types.js";

const terminalWorkflows: GroundingWorkflowDescriptor[] = [
  {
    workflowId: "terminal.answer",
    supportedIntents: ["inspect", "explain"],
    supportedDispositions: ["answer"],
    effectIds: ["terminal.answer"],
    requiredSourceClasses: ["repository_state"],
    authority: "read",
    allowedCapabilityIds: [],
    crossProviderAllowed: false,
  },
  {
    workflowId: "terminal.repository_change",
    supportedIntents: ["change", "continue"],
    supportedDispositions: ["execute"],
    effectIds: ["repository.change"],
    requiredSourceClasses: ["repository_state"],
    authority: "repository_write",
    allowedCapabilityIds: [],
    crossProviderAllowed: false,
  },
  {
    workflowId: "terminal.resolve_approval",
    supportedIntents: ["resolve_approval"],
    supportedDispositions: ["execute"],
    effectIds: ["authority.resolve"],
    requiredSourceClasses: ["current_workstream"],
    authority: "user_approval",
    allowedCapabilityIds: [],
    crossProviderAllowed: false,
  },
  {
    workflowId: "terminal.deliberate",
    supportedIntents: ["deliberate"],
    supportedDispositions: ["execute"],
    effectIds: ["deliberation.request"],
    requiredSourceClasses: ["repository_state"],
    authority: "user_approval",
    allowedCapabilityIds: [],
    crossProviderAllowed: true,
  },
];

const noDurableInstruction: DurableInstructionIntent = {
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

export async function resolveTerminalRequestGrounding(input: {
  request: string;
  provider: RunProvider;
  currentWorkstream: { workstreamId: string; revision: number } | null;
  semanticCatalog?: unknown;
  services: Pick<CliServices, "groundProductionRequest">;
}): Promise<
  GroundingDecision & {
    ambiguityReasons: string[];
    resolverResultDigest: string;
    durableInstruction: DurableInstructionIntent;
  }
> {
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
      grantedAuthorities: ["read", "repository_write", "user_approval"],
      workflows: terminalWorkflows,
      semanticCatalog: input.semanticCatalog,
      timeoutMs: 20_000,
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
      durableInstruction: noDurableInstruction,
    };
  }
}
