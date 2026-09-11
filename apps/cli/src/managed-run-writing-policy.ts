import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { DocumentRegistry, RoleProfile, WritingContract } from "@lervo/schemas";

const WRITING_DOCUMENT_ID = "doc_managed_run_writing_policy";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function prepareManagedRunWritingPolicy(input: {
  repositoryRoot: string;
  dataDirectory: string;
  registry: DocumentRegistry;
  role: RoleProfile;
  writingContract: WritingContract;
  verifiedAt: string;
}): Promise<{
  registry: DocumentRegistry;
  documentRules: Record<string, string[]>;
  writingPolicy: {
    writingPolicyId: string;
    documentId: string;
    contentHash: string;
  } | null;
}> {
  const presentation = input.role.outputContract.presentation;
  if (presentation.audience === "machine") {
    return { registry: input.registry, documentRules: {}, writingPolicy: null };
  }
  if (
    presentation.writingPolicyId !== input.writingContract.writingPolicyId ||
    !input.role.contextPolicy.requiredDocumentRuleIds.includes("writing.policy")
  ) {
    throw new TypeError("The human-facing managed role writing policy is not resolvable.");
  }
  const content = `${JSON.stringify(input.writingContract, null, 2)}\n`;
  const contentHash = digest(content);
  const directory = resolve(input.dataDirectory, "managed-run-writing");
  const absolutePath = resolve(directory, `${input.writingContract.writingPolicyId}.json`);
  const path = relative(input.repositoryRoot, absolutePath).split(sep).join("/");
  if (path.startsWith("../") || path === "..") {
    throw new TypeError("The managed role writing policy path is outside the repository.");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(absolutePath, "utf8")) !== content) {
      throw new TypeError("The managed role writing policy differs from the runtime contract.", {
        cause: error,
      });
    }
  }
  const registry = structuredClone(input.registry);
  registry.documents[WRITING_DOCUMENT_ID] = {
    path,
    kind: "generated",
    responsibleParty: { kind: "lervo", id: "lervo-managed-run" },
    connectedPaths: ["AGENTS.md"],
    verifiedRevision: contentHash,
    verifiedAt: input.verifiedAt,
    reviewIntervalDays: 30,
    ownership: {
      mode: "lervo_generated",
      userContentAllowed: false,
      manifestPath: path,
      inputs: [{ sourceId: `lervo:${input.writingContract.writingPolicyId}`, contentHash }],
    },
  };
  return {
    registry,
    documentRules: { "writing.policy": [WRITING_DOCUMENT_ID] },
    writingPolicy: {
      writingPolicyId: input.writingContract.writingPolicyId,
      documentId: WRITING_DOCUMENT_ID,
      contentHash,
    },
  };
}
