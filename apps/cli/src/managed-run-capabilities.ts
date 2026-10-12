import type { WorkforceAgent } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import type { RoleProfile } from "@lervo/schemas";
import type { ManagedRunDependencies, ManagedRunRequest } from "./managed-run-types.js";
import { resolveRunCapabilities } from "./run-capabilities.js";
import { defaultDependencies } from "./managed-run-composition.js";

/** Bind grounded capability selection to the existing role and hired-agent package ceiling. */
export async function prepareManagedRunCapabilities(input: {
  storage: ProjectStorage;
  request: ManagedRunRequest;
  dependencies: ManagedRunDependencies;
  instructions: string;
  requestedCapabilityIds: string[];
  role: RoleProfile;
  workforceAgent?: WorkforceAgent;
}) {
  const {
    storage,
    request,
    dependencies,
    instructions,
    requestedCapabilityIds,
    role,
    workforceAgent,
  } = input;
  const capabilityIds =
    requestedCapabilityIds.length === 0
      ? [...(role.defaultCapabilityPackages ?? [])]
      : requestedCapabilityIds;
  if (request.supervisedInvocation !== undefined && capabilityIds.length > 0)
    throw new TypeError("Supervised execution requires explicitly reviewed capability packages.");
  const runCapabilities = await resolveRunCapabilities({
    repositoryRoot: storage.paths.repositoryRoot,
    projectId: storage.manifest.projectId,
    provider: request.provider,
    role,
    capabilityIds,
    query: instructions,
    selectGroundedCapabilityIds: async (candidates) => {
      if (request.supervisedInvocation !== undefined) return [];
      const grounded = await (
        dependencies.groundProductionRequest ?? defaultDependencies.groundProductionRequest!
      )({
        request: instructions,
        provider: request.provider,
        resolutionContext: {
          priorTurns: [],
          currentWorkstream: null,
          pendingAuthorityIds: [],
          repositoryCondition: "current",
        },
        availableCapabilityIds: candidates.map((candidate) => candidate.capabilityId),
        grantedAuthorities: ["repository_write"],
        semanticCatalog: {
          capabilityCandidates: candidates.map((candidate) => ({
            capabilityId: candidate.capabilityId,
            kind: candidate.kind,
            version: candidate.version,
          })),
          structuredWorkflowSelection: "managed.run",
        },
        workflows: [
          {
            workflowId: "managed.run",
            supportedIntents: ["inspect", "explain", "change", "continue"],
            supportedDispositions: ["execute", "answer"],
            effectIds: ["managed.run"],
            requiredSourceClasses: ["repository_state"],
            authority: "repository_write",
            allowedCapabilityIds: candidates.map((candidate) => candidate.capabilityId),
            crossProviderAllowed: false,
          },
        ],
      });
      return grounded.decision.status === "ready" ? grounded.decision.capabilityIds : [];
    },
    generatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    ...(dependencies.userCapabilityRoot === undefined
      ? {}
      : { userRoot: dependencies.userCapabilityRoot }),
  });
  if (request.workforce !== undefined) {
    const bound = new Map(
      (workforceAgent?.capabilityPackages ?? []).map((item) => [item.capabilityId, item]),
    );
    if (
      runCapabilities.capabilities.some((item) => {
        const exact = bound.get(item.capabilityId);
        return (
          exact === undefined ||
          exact.version !== item.version ||
          exact.contentHash !== item.contentHash
        );
      })
    )
      throw new TypeError(
        "The managed run capability package set exceeds or differs from the hired agent contract.",
      );
  }
  return { capabilityIds, runCapabilities };
}

export function capabilitySelectionReason(input: {
  capabilityId: string;
  authoritativeCapabilityIds: readonly string[];
  explicitlyRequestedCapabilityIds: readonly string[];
  recommendedCapabilityIds: ReadonlySet<string>;
}): "explicit" | "role_default" | "natural_language" | "dependency" {
  if (input.authoritativeCapabilityIds.includes(input.capabilityId)) {
    return input.explicitlyRequestedCapabilityIds.length > 0 ? "explicit" : "role_default";
  }
  if (
    input.authoritativeCapabilityIds.length === 0 &&
    input.recommendedCapabilityIds.has(input.capabilityId)
  ) {
    return "natural_language";
  }
  return "dependency";
}
