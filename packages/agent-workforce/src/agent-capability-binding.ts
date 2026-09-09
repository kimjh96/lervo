import { createHash } from "node:crypto";

import { resolveCapabilities } from "@lervo/capabilities";
import { roleProfileHash, type ResolvedRoleContract } from "@lervo/roles";

import type { WorkforceAgent, WorkforceCapabilityPackage, WorkforceProvider } from "./types.js";

export interface AgentCapabilityBinding {
  roleProfileHash: WorkforceAgent["roleProfileHash"];
  capabilityHash: WorkforceAgent["capabilityHash"];
  capabilityPackages: WorkforceCapabilityPackage[];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function resolveAgentCapabilityBinding(input: {
  repositoryRoot: string;
  projectId: string;
  provider: WorkforceProvider;
  contract: ResolvedRoleContract;
  capabilityPackageIds: string[];
  generatedAt: string;
}): Promise<AgentCapabilityBinding> {
  const resolved = await resolveCapabilities({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    capabilityIds: input.capabilityPackageIds,
    provider: input.provider,
    platform: process.platform,
    generatedAt: input.generatedAt,
    allowedPermissions: Object.entries(input.contract.definition.profile.capabilities)
      .filter(([, decision]) => decision === "allow")
      .map(([permission]) => permission),
  });
  const capabilityPackages = resolved.selected.map(
    ({ capabilityId, kind, version, contentHash, sourceKind }) => ({
      capabilityId,
      kind,
      version,
      contentHash,
      sourceKind,
    }),
  );
  return {
    roleProfileHash: roleProfileHash(input.contract.definition.profile),
    capabilityHash: digest(
      stableJson({
        permissions: input.contract.definition.profile.capabilities,
        packages: capabilityPackages.map(({ capabilityId, version, contentHash }) => ({
          capabilityId,
          version,
          contentHash,
        })),
      }),
    ),
    capabilityPackages,
  };
}
