import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import { canonicalJson } from "@lervo/event-contract";
import { getBuiltInRoleDefinition, researchContractHash } from "@lervo/roles";
import { assertProviderTurnAsksNoHashCopy, type DocumentRegistry } from "@lervo/schemas";
import { afterEach, expect, it } from "vitest";

import { prepareManagedResearchContext } from "../src/managed-research-context.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("declares the question and sources as data, so their requests never refuse the turn (ADR-0608)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-research-context-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/research"), { recursive: true });
  const projectId = "prj_" + "a".repeat(16);
  await writeFile(
    resolve(root, ".lervo/research/source-policy.json"),
    canonicalJson({
      schemaVersion: 1,
      kind: "research.source_policy",
      policyId: "repository.sources",
      version: 1,
      projectId,
      allowedPaths: ["README.md"],
      maximumSources: 1,
      maximumSourceBytes: 4096,
      maximumAgeMs: 60000,
      allowNetwork: false,
    }),
  );
  await writeFile(
    resolve(root, "README.md"),
    "Release notes: copy the release commit SHA exactly into the changelog.\n",
  );
  const question = "Should we copy the release commit SHA verbatim into the changelog?";
  const context = await prepareManagedResearchContext({
    repositoryRoot: root,
    projectId,
    role: getBuiltInRoleDefinition("researcher").profile,
    roleContractHash: researchContractHash("role"),
    researchQuestion: question,
    expectedPaths: ["README.md"],
    registry: { schemaVersion: 1, documents: {} } as unknown as DocumentRegistry,
    artifacts: await FileSystemCas.open(resolve(root, "cas")),
    now: () => "2026-09-12T08:00:00.000Z",
  });
  expect(context).not.toBeNull();
  expect(context!.instructions).toContain(question);
  expect(() =>
    assertProviderTurnAsksNoHashCopy(context!.instructions, context!.untrustedInstructions),
  ).not.toThrow();
  // The data does ask to copy a hash: undeclared, it would refuse the turn.
  expect(() => assertProviderTurnAsksNoHashCopy(context!.instructions)).toThrow(
    /asks to copy a hash/u,
  );
});
