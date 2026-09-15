import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { defaultEnglishWritingContract } from "@lervo/core";
import type { DocumentRegistry, RoleProfile } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { prepareManagedRunWritingPolicy } from "../src/managed-run-writing-policy.js";

const roots: string[] = [];
const registry: DocumentRegistry = { schemaVersion: 1, documents: {} };

function role(audience: "human" | "machine"): RoleProfile {
  return {
    schemaVersion: 1,
    roleId: "test-role",
    name: "Test role",
    description: "Exercises managed role writing policy preparation.",
    requestTypes: ["test"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds:
        audience === "human" ? ["repository.instructions", "writing.policy"] : [],
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "deny",
      "shell.execute": "deny",
      "network.access": "deny",
      "external.message": "deny",
      "computer.use": "deny",
      deploy: "deny",
      "data.mutate": "deny",
    },
    defaultSkills: [],
    outputContract: {
      artifactKind: "test",
      schemaRef: "lervo-schema://test/v1",
      pathTemplate: ".lervo/generated/test/{runId}.md",
      citationsRequired: true,
      presentation:
        audience === "human"
          ? {
              audience,
              locale: "en",
              writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
            }
          : { audience, writingPolicyId: null },
    },
    verification: { suiteIds: ["repository.default"], failureDisposition: "fail_run" },
    handoff: { allowedRoleIds: [], evidenceLinksRequired: true, sharedContextRequired: true },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed run writing policy", () => {
  it("materializes and binds the exact policy required by a human-facing role", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-writing-"));
    roots.push(root);
    const result = await prepareManagedRunWritingPolicy({
      repositoryRoot: root,
      dataDirectory: resolve(root, ".lervo/data"),
      registry,
      role: role("human"),
      writingContract: defaultEnglishWritingContract,
      verifiedAt: "2026-09-10T00:00:00.000Z",
    });

    expect(result.documentRules).toEqual({
      "writing.policy": ["doc_managed_run_writing_policy"],
    });
    expect(result.writingPolicy).toMatchObject({
      writingPolicyId: "writing_en-human",
      documentId: "doc_managed_run_writing_policy",
    });
    const record = result.registry.documents.doc_managed_run_writing_policy!;
    expect(JSON.parse(await readFile(resolve(root, record.path), "utf8"))).toEqual(
      defaultEnglishWritingContract,
    );
  });

  it("keeps machine-facing roles free of a writing-policy binding", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-writing-"));
    roots.push(root);
    await expect(
      prepareManagedRunWritingPolicy({
        repositoryRoot: root,
        dataDirectory: resolve(root, ".lervo/data"),
        registry,
        role: role("machine"),
        writingContract: defaultEnglishWritingContract,
        verifiedAt: "2026-09-10T00:00:00.000Z",
      }),
    ).resolves.toEqual({ registry, documentRules: {}, writingPolicy: null });
  });
});
