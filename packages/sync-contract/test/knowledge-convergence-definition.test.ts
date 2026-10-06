import { describe, expect, it } from "vitest";

import {
  createKnowledgeConvergenceDefinition,
  isKnowledgeConvergenceDefinition,
  knowledgeConvergenceTextHash,
  MAXIMUM_CONVERGENCE_DEFINITION_BYTES,
  syncContentHash,
} from "../src/index.js";

const base = {
  projectId: "prj_definition_contract",
  repositoryIdentityHash: `sha256:${"1".repeat(64)}`,
  publishedAt: "2026-10-06T00:00:00.000Z",
  sourceHostHash: `sha256:${"2".repeat(64)}`,
};
const suite = { schemaVersion: 1, suiteId: "repository.knowledge", commands: [] };

describe("delegation-bound definitions (ADR-0477)", () => {
  it("accepts a suite only when its content hash is the binding", () => {
    const definition = createKnowledgeConvergenceDefinition({
      ...base,
      kind: "verification_suite",
      bindingHash: syncContentHash(suite),
      content: suite,
    });
    expect(definition).toMatchObject({ contentHash: syncContentHash(suite) });
    expect(
      createKnowledgeConvergenceDefinition({
        ...base,
        kind: "verification_suite",
        bindingHash: `sha256:${"3".repeat(64)}`,
        content: suite,
      }),
    ).toBeNull();
    expect(
      isKnowledgeConvergenceDefinition({ ...definition, content: { ...suite, suiteId: "other" } }),
    ).toBe(false);
  });

  it("binds a manifest to the hash of its exact bytes and a role to its own source", () => {
    const text = '﻿{"schemaVersion":1,"dispositions":[]}\n';
    expect(
      createKnowledgeConvergenceDefinition({
        ...base,
        kind: "asset_disposition_manifest",
        bindingHash: knowledgeConvergenceTextHash(text),
        content: { text },
      }),
    ).not.toBeNull();
    const role = { roleId: "knowledge-steward", sources: [{ roleId: "knowledge-steward" }] };
    expect(
      createKnowledgeConvergenceDefinition({
        ...base,
        kind: "repository_role",
        bindingHash: `sha256:${"4".repeat(64)}`,
        content: role,
      }),
    ).not.toBeNull();
    expect(
      createKnowledgeConvergenceDefinition({
        ...base,
        kind: "repository_role",
        bindingHash: `sha256:${"4".repeat(64)}`,
        content: { roleId: "knowledge-steward", sources: [{ roleId: "someone-else" }] },
      }),
    ).toBeNull();
  });

  it("bounds a definition's size", () => {
    const large = { ...suite, padding: "x".repeat(MAXIMUM_CONVERGENCE_DEFINITION_BYTES) };
    expect(
      createKnowledgeConvergenceDefinition({
        ...base,
        kind: "verification_suite",
        bindingHash: syncContentHash(large),
        content: large,
      }),
    ).toBeNull();
  });
});
