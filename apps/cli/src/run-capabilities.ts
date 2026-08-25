import type { AdapterCapabilityActivationRequest, RoleProfile } from "@lervo/schemas";
import {
  createCapabilityActivationRequests,
  recommendCapabilities,
  resolveCapabilities,
  writeCapabilityLock,
  type ResolvedCapability,
  type CapabilityRecommendation,
} from "@lervo/capabilities";

import type { RunProvider } from "./managed-run.js";

export async function resolveRunCapabilities(input: {
  repositoryRoot: string;
  projectId: string;
  provider: RunProvider;
  role: RoleProfile;
  capabilityIds: readonly string[];
  generatedAt: string;
  query: string;
  userRoot?: string;
}): Promise<{
  capabilities: ResolvedCapability[];
  skillIds: string[];
  activations: AdapterCapabilityActivationRequest[];
  recommendations: CapabilityRecommendation[];
}> {
  const recommendations =
    input.capabilityIds.length === 0
      ? await recommendCapabilities({
          repositoryRoot: input.repositoryRoot,
          query: input.query,
          provider: input.provider,
          platform: process.platform,
          ...(input.userRoot === undefined ? {} : { userRoot: input.userRoot }),
        })
      : [];
  const capabilityIds =
    input.capabilityIds.length === 0
      ? recommendations.map((item) => item.capabilityId)
      : [...input.capabilityIds];
  if (capabilityIds.length === 0)
    return { capabilities: [], skillIds: [], activations: [], recommendations };
  const resolution = await resolveCapabilities({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    capabilityIds,
    provider: input.provider,
    platform: process.platform,
    generatedAt: input.generatedAt,
    allowedPermissions: Object.entries(input.role.capabilities)
      .filter(([, decision]) => decision === "allow")
      .map(([permission]) => permission),
    ...(input.userRoot === undefined ? {} : { userRoot: input.userRoot }),
  });
  await writeCapabilityLock(input.repositoryRoot, resolution.lock);
  return {
    capabilities: resolution.selected,
    skillIds: resolution.selected.flatMap((item) =>
      item.entrypoint.kind === "skill" ? [item.entrypoint.skillId] : [],
    ),
    activations: await createCapabilityActivationRequests(resolution.activationPackages),
    recommendations,
  };
}
