import { createHash } from "node:crypto";

import type { AdapterContextEnvelope, AdapterSession } from "@lervo/schemas";

import { inspectContextEnvelopeBinding } from "./context-binding.js";

export type ContextMaterializationFailureCode =
  "session_mismatch" | "context_materialization_failed";

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
      "Context documents must be valid UTF-8.",
    );
  }
  if (!Buffer.from(content, "utf8").equals(Buffer.from(bytes))) {
    throw new ContextMaterializationError(
      "context_materialization_failed",
      "The context document cannot be converted to a string without loss.",
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
        "No artifact resolver is available to read CAS context.",
      );
    }
    try {
      bytes = new Uint8Array(await resolveArtifact(document.delivery.uri));
    } catch {
      throw new ContextMaterializationError(
        "context_materialization_failed",
        "The CAS context document could not be read.",
      );
    }
  }
  if (bytes.byteLength !== document.byteCount || digest(bytes) !== document.contentHash) {
    throw new ContextMaterializationError(
      "context_materialization_failed",
      `The bytes for context document ${document.documentId} do not match the envelope metadata.`,
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
      "The context envelope does not match the managed session.",
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
