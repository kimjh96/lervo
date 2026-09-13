import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  getBuiltInRoleDefinition,
  prepareResearchInputs,
  researchContractHash,
  verifyResearchBrief,
  type ResearchSourcePolicyV1,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("binds a brief to actual repository source bytes and rejects invented provenance, stale sources and symlinks", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-research-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/research"), { recursive: true });
  const policy: ResearchSourcePolicyV1 = {
    schemaVersion: 1,
    kind: "research.source_policy",
    policyId: "research.repository",
    version: 1,
    projectId: "prj_" + "a".repeat(16),
    allowedPaths: ["README.md"],
    maximumSources: 1,
    maximumSourceBytes: 4096,
    maximumAgeMs: 60000,
    allowNetwork: false,
  };
  await writeFile(resolve(root, ".lervo/research/source-policy.json"), JSON.stringify(policy));
  await writeFile(resolve(root, "README.md"), "The product runs locally without a Hub.\n");
  const now = "2026-09-12T08:00:00.000Z";
  const request = {
    repositoryRoot: root,
    projectId: policy.projectId,
    researchQuestion: "Does local execution require a Hub?",
    role: getBuiltInRoleDefinition("researcher").profile,
    roleContractHash: researchContractHash("researcher"),
    now: () => now,
  };
  const captured = await prepareResearchInputs(request);
  const { sourceId, url, retrievedAt, contentHash } = captured.inputs.sources[0]!;
  const manifest = {
    schemaVersion: 1,
    kind: "research.brief",
    inputHash: captured.inputHash,
    sources: [{ sourceId, url, retrievedAt, contentHash }],
  };
  const content = `Local execution works without a Hub.[^S1]\n\n[^S1]: ${url}\n\n<!-- lervo-research ${JSON.stringify(manifest)} -->`;
  expect(verifyResearchBrief({ content, inputs: captured.inputs, now })).toMatchObject({
    status: "passed",
    inputHash: captured.inputHash,
  });
  expect(() =>
    verifyResearchBrief({
      content: content.replace(contentHash, researchContractHash("invented source")),
      inputs: captured.inputs,
      now,
    }),
  ).toThrow(/citation/iu);
  expect(() =>
    verifyResearchBrief({
      content: content.replace("[^S1]:", "[^S2]:"),
      inputs: captured.inputs,
      now,
    }),
  ).toThrow(/citation/iu);
  expect(() =>
    verifyResearchBrief({ content, inputs: captured.inputs, now: "2026-09-12T08:02:00.000Z" }),
  ).toThrow(/retrieval age/iu);
  await rm(resolve(root, "README.md"));
  await symlink(resolve(root, ".lervo/research/source-policy.json"), resolve(root, "README.md"));
  await expect(prepareResearchInputs(request)).rejects.toThrow(/regular files/iu);
});
