import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import {
  type DocumentRegistry,
  type RoleProfile,
  type WritingContract,
  validateSchema,
} from "@lervo/schemas";

export const conversationWritingDocumentId = "doc_node_conversation_writing_policy";

export function conversationPolicyDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createConversationReadOnlyRole(
  roleId: string,
  writingContract: WritingContract,
): RoleProfile {
  const role: RoleProfile = {
    schemaVersion: 1,
    roleId,
    name: "Conversation reader",
    description: "Answers repository questions without changing files or external state.",
    requestTypes: ["conversation.response"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds: ["repository.instructions", "writing.policy"],
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
      artifactKind: "conversation_reply",
      schemaRef: "lervo-schema://outputs/conversation-reply/v1",
      pathTemplate: ".lervo/generated/conversation/{runId}.md",
      citationsRequired: true,
      presentation: {
        audience: "human",
        locale: "en",
        writingPolicyId: writingContract.writingPolicyId,
      },
    },
    verification: { suiteIds: ["conversation.reply"], failureDisposition: "fail_run" },
    handoff: { allowedRoleIds: [], evidenceLinksRequired: true, sharedContextRequired: true },
  };
  if (!validateSchema("role", role).valid) {
    throw new Error("The managed Discord read-only role is invalid.");
  }
  return role;
}

export async function provisionConversationWritingPolicy(input: {
  repositoryRoot: string;
  dataDirectory: string;
  registry: DocumentRegistry;
  verifiedAt: string;
  writingContract: WritingContract;
}): Promise<{ registry: DocumentRegistry; path: string; contentHash: string }> {
  const content = `${JSON.stringify(input.writingContract, null, 2)}\n`;
  const contentHash = conversationPolicyDigest(content);
  const absolutePath = resolve(
    input.dataDirectory,
    `managed-read-${input.writingContract.writingPolicyId}.json`,
  );
  const path = relative(input.repositoryRoot, absolutePath).split(sep).join("/");
  if (path.startsWith("../") || path === "..") {
    throw new Error("The Discord conversation data directory is outside the repository.");
  }
  await mkdir(input.dataDirectory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(absolutePath, "utf8")) !== content) {
      throw new Error(
        "The managed Discord conversation writing policy differs from runtime code.",
        {
          cause: error,
        },
      );
    }
  }
  const registry = structuredClone(input.registry);
  registry.documents[conversationWritingDocumentId] = {
    path,
    kind: "generated",
    responsibleParty: { kind: "lervo", id: "lervo-node-runtime" },
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
  return { registry, path, contentHash };
}
