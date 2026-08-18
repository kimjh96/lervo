import { createHash } from "node:crypto";

import { inspectContextEnvelopeBinding } from "@roven/adapter-contract";
import type { AdapterContextEnvelope, AdapterSession } from "@roven/schemas";

import { CodexAdapterError } from "./types.js";

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeUtf8(bytes: Uint8Array): string {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CodexAdapterError(
      "context_materialization_failed",
      "Codex에 전달할 context 문서는 UTF-8이어야 합니다.",
    );
  }
  if (!Buffer.from(content, "utf8").equals(Buffer.from(bytes))) {
    throw new CodexAdapterError(
      "context_materialization_failed",
      "Codex context 문서를 손실 없이 문자열로 변환할 수 없습니다.",
    );
  }
  return content;
}

async function materializeDocument(
  document: AdapterContextEnvelope["documents"][number],
  resolveArtifact: ((uri: string) => Promise<Uint8Array>) | undefined,
): Promise<string> {
  let bytes: Uint8Array;
  if (document.delivery.kind === "inline") {
    bytes = Buffer.from(document.delivery.content, "utf8");
  } else {
    if (resolveArtifact === undefined) {
      throw new CodexAdapterError(
        "context_materialization_failed",
        "CAS context를 읽는 artifact resolver가 없습니다.",
      );
    }
    try {
      bytes = new Uint8Array(await resolveArtifact(document.delivery.uri));
    } catch {
      throw new CodexAdapterError(
        "context_materialization_failed",
        "CAS context 문서를 읽지 못했습니다.",
      );
    }
  }
  if (bytes.byteLength !== document.byteCount || digest(bytes) !== document.contentHash) {
    throw new CodexAdapterError(
      "context_materialization_failed",
      `Context 문서 ${document.documentId}의 bytes와 envelope metadata가 다릅니다.`,
    );
  }
  return decodeUtf8(bytes);
}

export async function buildManagedContextItems(
  session: AdapterSession,
  envelope: AdapterContextEnvelope,
  resolveArtifact: ((uri: string) => Promise<Uint8Array>) | undefined,
): Promise<unknown[]> {
  const binding = inspectContextEnvelopeBinding({
    session,
    envelope,
    expectedContextGeneration: envelope.contextGeneration,
  });
  if (!binding.passed) {
    throw new CodexAdapterError(
      "session_mismatch",
      "Context envelope가 managed Codex session과 일치하지 않습니다.",
    );
  }

  const items: unknown[] = [];
  for (const document of envelope.documents) {
    const content = await materializeDocument(document, resolveArtifact);
    const managedContext = {
      kind: "roven_managed_context",
      envelopeId: envelope.envelopeId,
      targetTurnId: envelope.targetTurnId,
      contextGeneration: envelope.contextGeneration,
      roleId: envelope.roleId,
      writingPolicyId: envelope.writingPolicyId,
      writingPolicyDocumentId: envelope.writingPolicyDocumentId,
      document: {
        documentId: document.documentId,
        path: document.path,
        contentHash: document.contentHash,
        scope: document.scope,
        content,
      },
    };
    items.push({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: JSON.stringify(managedContext) }],
    });
  }
  return items;
}
