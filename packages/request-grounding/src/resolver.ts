import { createHash } from "node:crypto";

import { decideGroundedRequest } from "./decision.js";
import { parseSemanticGroundingProposal } from "./proposal.js";
import { extractProtocolCoordinates } from "./protocol-coordinate.js";
import type {
  GroundingDecision,
  GroundingDecisionContext,
  SemanticGroundingProposal,
} from "./types.js";

export interface GroundingPriorTurn {
  role: "user" | "assistant";
  text: string;
}

export interface GroundingResolutionContext {
  priorTurns: GroundingPriorTurn[];
  currentWorkstream: { workstreamId: string; revision: number } | null;
  pendingAuthorityIds: string[];
  repositoryCondition: "current" | "stale" | "no_matching_source";
}

export interface SemanticGroundingResolverPort {
  providerId: string;
  resolve(input: {
    request: string;
    requestDigest: string;
    context: GroundingResolutionContext;
  }): Promise<unknown>;
}

function requestDigest(request: string): string {
  return `sha256:${createHash("sha256").update(request).digest("hex")}`;
}

function validateInput(request: string, context: GroundingResolutionContext): void {
  if (request.length < 1 || Buffer.byteLength(request) > 16 * 1024) {
    throw new TypeError("The grounding request must contain at most 16 KiB of text.");
  }
  if (context.priorTurns.length > 4) {
    throw new TypeError("Grounding context may contain at most four prior turns.");
  }
  for (const turn of context.priorTurns) {
    if (
      (turn.role !== "user" && turn.role !== "assistant") ||
      Buffer.byteLength(turn.text) > 2_048
    ) {
      throw new TypeError("A grounding prior turn is invalid or exceeds 2 KiB.");
    }
  }
  if (
    context.currentWorkstream !== null &&
    (!/^wks_[a-f0-9]{24}$/u.test(context.currentWorkstream.workstreamId) ||
      !Number.isSafeInteger(context.currentWorkstream.revision) ||
      context.currentWorkstream.revision < 1)
  ) {
    throw new TypeError("The current workstream coordinate is invalid.");
  }
  if (
    context.pendingAuthorityIds.length > 16 ||
    context.pendingAuthorityIds.some((id) => !/^(?:wapr|apr)_[A-Za-z0-9_-]{8,128}$/u.test(id)) ||
    new Set(context.pendingAuthorityIds).size !== context.pendingAuthorityIds.length
  ) {
    throw new TypeError("Pending authority coordinates are invalid or unbounded.");
  }
}

export async function resolveGroundedRequest(input: {
  request: string;
  resolutionContext: GroundingResolutionContext;
  decisionContext: GroundingDecisionContext;
  resolver: SemanticGroundingResolverPort;
}): Promise<{ proposal: SemanticGroundingProposal; decision: GroundingDecision }> {
  validateInput(input.request, input.resolutionContext);
  if (input.resolver.providerId !== input.decisionContext.currentProviderId) {
    throw new TypeError("The grounding resolver must use the current provider adapter.");
  }
  const digest = requestDigest(input.request);
  const proposal = parseSemanticGroundingProposal(
    await input.resolver.resolve({
      request: input.request,
      requestDigest: digest,
      context: input.resolutionContext,
    }),
  );
  if (proposal.requestDigest !== digest) {
    throw new TypeError("The semantic grounding proposal is bound to another request.");
  }
  if (proposal.resolver.providerId !== input.resolver.providerId) {
    throw new TypeError("The semantic grounding proposal is bound to another provider.");
  }
  const exactCoordinates = extractProtocolCoordinates(
    [input.request, ...input.resolutionContext.priorTurns.map((turn) => turn.text)].join("\n"),
  );
  if (input.resolutionContext.currentWorkstream !== null) {
    exactCoordinates.push({
      kind: "workstream_id",
      value: input.resolutionContext.currentWorkstream.workstreamId,
    });
  }
  for (const value of input.resolutionContext.pendingAuthorityIds) {
    exactCoordinates.push({ kind: "approval_id", value });
  }
  const allowedCoordinates = new Set(
    exactCoordinates.map((coordinate) => `${coordinate.kind}:${coordinate.value}`),
  );
  if (
    proposal.protocolCoordinates.some(
      (coordinate) => !allowedCoordinates.has(`${coordinate.kind}:${coordinate.value}`),
    )
  ) {
    throw new TypeError("The semantic proposal invented a protocol coordinate.");
  }
  return {
    proposal,
    decision: decideGroundedRequest({ proposal, context: input.decisionContext }),
  };
}
