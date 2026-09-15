import { createHash } from "node:crypto";
import { resolve } from "node:path";

import type {
  OrganizationExecutiveEffect,
  OrganizationExecutiveEffectPort,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";

import {
  bindAgentOrganizationTeam,
  inspectAgentOrganization,
} from "./agent-organization-runtime-binding.js";

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function parameters(value: unknown): { repositoryRoot: string; teamKind: "central" | "project" } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("The repository organization effect parameters are invalid.");
  }
  const source = value as Record<string, unknown>;
  if (
    Object.keys(source).sort().join(",") !== "repositoryRoot,teamKind" ||
    typeof source.repositoryRoot !== "string" ||
    !["central", "project"].includes(String(source.teamKind))
  ) {
    throw new TypeError("The repository organization effect parameters are invalid.");
  }
  return {
    repositoryRoot: source.repositoryRoot,
    teamKind: source.teamKind as "central" | "project",
  };
}

export class RepositoryOrganizationExecutiveEffectAdapter implements OrganizationExecutiveEffectPort {
  readonly adapterId = "repository_organization_v1";
  readonly actions = ["team.create"] as const;
  private readonly cwd: string;
  private readonly roots: Set<string>;

  constructor(input: { cwd: string; allowedRepositoryRoots: readonly string[] }) {
    this.cwd = input.cwd;
    this.roots = new Set(input.allowedRepositoryRoots.map((root) => resolve(input.cwd, root)));
  }

  async apply(effect: Readonly<OrganizationExecutiveEffect>) {
    if (effect.action !== "team.create" || effect.teamId === null) {
      return { status: "rejected" as const, reasonCode: "action_not_supported" };
    }
    const requested = parameters(effect.parameters);
    const repositoryRoot = resolve(this.cwd, requested.repositoryRoot);
    if (!this.roots.has(repositoryRoot)) {
      return { status: "rejected" as const, reasonCode: "repository_not_allowlisted" };
    }
    const current = await inspectAgentOrganization(repositoryRoot);
    if (
      current.team !== null &&
      (current.team.organizationId !== effect.organizationId ||
        current.team.teamId !== effect.teamId ||
        current.team.teamKind !== requested.teamKind)
    ) {
      return { status: "rejected" as const, reasonCode: "team_binding_conflict" };
    }
    const projection = await bindAgentOrganizationTeam({
      root: repositoryRoot,
      organizationId: effect.organizationId,
      teamId: effect.teamId,
      teamKind: requested.teamKind,
    });
    return {
      status: "completed" as const,
      externalEffectId: effect.teamId,
      resultHash: hash(projection),
      completedAt: projection.team?.boundAt ?? new Date().toISOString(),
    };
  }
}
