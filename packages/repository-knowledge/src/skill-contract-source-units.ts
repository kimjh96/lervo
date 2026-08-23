import { dirname, resolve } from "node:path";

import { validateSchema, type SkillManifest } from "@lervo/schemas";
import { hashSkillPackage } from "@lervo/skills";

import type { RepositorySource } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

export const SKILL_CONTRACT_SOURCE_UNIT_ADAPTER = "lervo-skill-contract-v1+skill-schema-v1";

export interface SkillContractUnitDescriptor {
  path: string;
  locator: string;
  title: string;
}

const manifestPath = /^(?:\.agents\/skills)\/[^/]+\/lervo-skill\.json$/u;

function fail(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_unit_extraction_failed",
    "The project skill contract source cannot be verified safely and completely.",
  );
}

export async function extractSkillContractUnitDescriptors(input: {
  repositoryRoot: string;
  sources: readonly (RepositorySource & { content: string; contentHash: string })[];
}): Promise<SkillContractUnitDescriptor[]> {
  const byPath = new Map(input.sources.map((source) => [source.path, source]));
  const descriptors: SkillContractUnitDescriptor[] = [];
  for (const source of input.sources.filter((item) => manifestPath.test(item.path))) {
    let manifest: SkillManifest;
    try {
      const parsed = JSON.parse(source.content) as unknown;
      if (!validateSchema("skill", parsed).valid) return fail();
      manifest = parsed as SkillManifest;
    } catch {
      return fail();
    }
    if (manifest.source.kind !== "project") return fail();
    const directory = dirname(source.path);
    try {
      const packageDirectory = resolve(input.repositoryRoot, ...directory.split("/"));
      const firstHash = await hashSkillPackage(packageDirectory);
      const secondHash = await hashSkillPackage(packageDirectory);
      if (firstHash !== secondHash || firstHash !== manifest.contentHash) return fail();
    } catch {
      return fail();
    }
    const identity = `${manifest.skillId}@${manifest.version}`;
    descriptors.push({
      path: source.path,
      locator: `skill:${identity}/manifest`,
      title: `Skill ${identity} manifest`,
    });
    const instructionsPath = `${directory}/SKILL.md`;
    if (byPath.has(instructionsPath)) {
      descriptors.push({
        path: instructionsPath,
        locator: `skill:${identity}/instructions`,
        title: `Skill ${identity} instructions`,
      });
    }
  }
  return descriptors.sort((left, right) => left.path.localeCompare(right.path) || left.locator.localeCompare(right.locator));
}
