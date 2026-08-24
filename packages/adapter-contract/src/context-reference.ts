import type { AdapterContextEnvelope } from "@lervo/schemas";

export const managedContextReferenceInstruction =
  "If the final response explicitly relies on a supplied document, append that document's exact evidenceToken as a standalone Markdown HTML comment in the form <!-- evidenceToken -->. The comment is machine evidence and is removed from the human-facing publication. It proves only an observable output citation, not understanding, correctness, or internal use.";

export function managedContextReferenceToken(input: {
  documentId: string;
  contentHash: string;
}): string {
  return `lervo-e4:${input.documentId}:${input.contentHash}`;
}

export function managedContextReferenceComment(input: {
  documentId: string;
  contentHash: string;
}): string {
  return `<!-- ${managedContextReferenceToken(input)} -->`;
}

export function referencedManagedContextDocuments(
  content: string,
  documents: AdapterContextEnvelope["documents"],
): AdapterContextEnvelope["documents"] {
  return documents.filter((document) =>
    content.includes(managedContextReferenceToken(document))
  ).map((document) => structuredClone(document));
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function managedContextPublicationContent(
  content: string,
  documents: AdapterContextEnvelope["documents"],
): string {
  let publication = content;
  for (const document of documents) {
    const token = escapeRegularExpression(managedContextReferenceToken(document));
    publication = publication
      .replace(new RegExp(`^[\\t ]*<!--[\\t ]*${token}[\\t ]*-->[\\t ]*(?:\\r?\\n|$)`, "gm"), "")
      .replace(new RegExp(token, "g"), "");
  }
  return publication;
}
