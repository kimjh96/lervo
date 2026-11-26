import type { AdapterContextEnvelope } from "@lervo/schemas";
import {
  ManagedContextReferenceError,
  projectManagedContextReferences,
  type ManagedContextReferenceProjection,
} from "./context-reference-projection.js";

export const managedJsonReferenceContract = {
  schemaVersion: 1,
  format: "json",
  referencePolicy: "standalone_comments_in_string_values",
} as const;

/** Applies the ordinary Markdown citation boundary to decoded JSON string values. */
export function projectManagedJsonContextReferences(
  content: string,
  documents: AdapterContextEnvelope["documents"],
): ManagedContextReferenceProjection {
  const referenced = new Map<string, AdapterContextEnvelope["documents"][number]>();
  try {
    JSON.parse(content);
  } catch (error) {
    if (error instanceof ManagedContextReferenceError) throw error;
    throw new ManagedContextReferenceError(
      "json_parse_failed",
      "The structured managed result is not valid JSON.",
      { cause: error },
    );
  }
  // Keep number lexemes and duplicate keys intact; reserialize only changed string values.
  const parts: string[] = [];
  let cursor = 0;
  for (const match of content.matchAll(/"(?:[^"\\]|\\.)*"/gu)) {
    const end = match.index + match[0].length;
    if (content.slice(end).trimStart().startsWith(":")) continue;
    const value = JSON.parse(match[0]) as string;
    const result = projectManagedContextReferences(value, documents);
    for (const document of result.referencedDocuments)
      referenced.set(document.documentId, document);
    if (result.publicationContent === value) continue;
    parts.push(content.slice(cursor, match.index), JSON.stringify(result.publicationContent));
    cursor = end;
  }
  parts.push(content.slice(cursor));
  return {
    referencedDocuments: documents.filter((document) => referenced.has(document.documentId)),
    publicationContent: parts.join(""),
  };
}
