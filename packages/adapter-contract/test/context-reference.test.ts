import type { AdapterContextEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  managedContextDocumentReferenceMetadata,
  managedContextPublicationContent,
  managedContextReferenceComment,
  managedContextReferenceToken,
  referencedManagedContextDocuments,
} from "../src/index.js";

const documents = [
  {
    documentId: "doc_reference1",
    path: "AGENTS.md",
    contentHash: `sha256:${"a".repeat(64)}`,
    byteCount: 12,
    scope: { kind: "full" as const },
    documentRole: "task_evidence" as const,
    referenceEligible: true,
    delivery: { kind: "inline" as const, content: "Instructions" },
  },
] satisfies AdapterContextEnvelope["documents"];

describe("managed context reference metadata", () => {
  it("detects exact E4 references while removing their standalone comment from publication", () => {
    const comment = managedContextReferenceComment(documents[0]!);
    const result = `The requested change is complete.\n\n${comment}\n`;

    expect(referencedManagedContextDocuments(result, documents)).toEqual(documents);
    expect(managedContextPublicationContent(result, documents)).toBe(
      "The requested change is complete.\n\n",
    );
  });

  it("removes only tokens for injected document versions", () => {
    const known = managedContextReferenceToken(documents[0]!);
    const unknown = `lervo-e4:doc_unknown1:sha256:${"b".repeat(64)}`;

    expect(managedContextPublicationContent(`Used ${known}; retained ${unknown}.`, documents)).toBe(
      `Used ; retained ${unknown}.`,
    );
  });

  it("provides tokens only for typed task evidence without filtering raw observations", () => {
    const governance = {
      ...documents[0]!,
      documentId: "doc_governance1",
      documentRole: "governance_context" as const,
      referenceEligible: false,
    };

    expect(managedContextDocumentReferenceMetadata(documents[0]!)).toEqual({
      documentRole: "task_evidence",
      referenceEligible: true,
      evidenceToken: managedContextReferenceToken(documents[0]!),
    });
    expect(managedContextDocumentReferenceMetadata(governance)).toEqual({
      documentRole: "governance_context",
      referenceEligible: false,
      evidenceToken: null,
    });

    const rawGovernanceToken = managedContextReferenceToken(governance);
    expect(referencedManagedContextDocuments(rawGovernanceToken, [governance])).toEqual([]);
  });

  it("does not turn a fabricated token for supporting task context into E4 evidence", () => {
    const supporting = { ...documents[0]!, referenceEligible: false };

    expect(managedContextDocumentReferenceMetadata(supporting)).toEqual({
      documentRole: "task_evidence",
      referenceEligible: false,
      evidenceToken: null,
    });
    expect(
      referencedManagedContextDocuments(managedContextReferenceToken(supporting), [supporting]),
    ).toEqual([]);
  });
});
