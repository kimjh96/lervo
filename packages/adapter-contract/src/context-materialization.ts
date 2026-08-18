import { createHash } from "node:crypto";

import type { AdapterContextEnvelope, AdapterSession } from "@lervo/schemas";

import { inspectContextEnvelopeBinding } from "./context-binding.js";

export type ContextMaterializationFailureCode =
  | "session_mismatch"
  | "context_materialization_failed";

export class ContextMaterializationError extends Error {
  constructor(
    readonly code: ContextMaterializationFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "ContextMaterializationError";
  }
}

export interface MaterializedContextDocument {
  document: AdapterContextEnvelope["documents"][number];
  content: string;
}

export type ContextArtifactResolver = (uri: string) => Promise<Uint8Array>;

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function decodeUtf8(bytes: Uint8Array): string {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ContextMaterializationError(
      "context_materialization_failed",
      "Context 문서는 UTF-8이어야 합니다.",
    );
  }
  if (!Buffer.from(content, "utf8").equals(Buffer.from(bytes))) {
    throw new ContextMaterializationError(
      "context_materialization_failed",
      "Context 문서를 손실 없이 문자열로 변환할 수 없습니다.",
    );
  }
  return content;
}

async function materializeDocument(
  document: AdapterContextEnvelope["documents"][number],
  resolveArtifact: ContextArtifactResolver | undefined,
): Promise<string> {
  let bytes: Uint8Array;
  if (document.delivery.kind === "inline") {
    bytes = Buffer.from(document.delivery.content, "utf8");
  } else {
    if (resolveArtifact === undefined) {
      throw new ContextMaterializationError(
        "context_materialization_failed",
        "CAS context를 읽는 artifact resolver가 없습니다.",
      );
    }
    try {
      bytes = new Uint8Array(await resolveArtifact(document.delivery.uri));
    } catch {
      throw new ContextMaterializationError(
        "context_materialization_failed",
        "CAS context 문서를 읽지 못했습니다.",
      );
    }
  }
  if (bytes.byteLength !== document.byteCount || digest(bytes) !== document.contentHash) {
    throw new ContextMaterializationError(
      "context_materialization_failed",
      `Context 문서 ${document.documentId}의 bytes와 envelope metadata가 다릅니다.`,
    );
  }
  return decodeUtf8(bytes);
}

export async function materializeContextEnvelope(
  session: AdapterSession,
  envelope: AdapterContextEnvelope,
  resolveArtifact?: ContextArtifactResolver,
): Promise<MaterializedContextDocument[]> {
  const binding = inspectContextEnvelopeBinding({
    session,
    envelope,
    expectedContextGeneration: envelope.contextGeneration,
  });
  if (!binding.passed) {
    throw new ContextMaterializationError(
      "session_mismatch",
      "Context envelope가 managed session과 일치하지 않습니다.",
    );
  }

  const materialized: MaterializedContextDocument[] = [];
  for (const document of envelope.documents) {
    materialized.push({
      document: structuredClone(document),
      content: await materializeDocument(document, resolveArtifact),
    });
  }
  return materialized;
}
