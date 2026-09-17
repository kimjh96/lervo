import type { AdapterContextEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  ManagedContextReferenceError,
  managedContextReferenceComment,
  managedContextReferenceToken,
  projectManagedContextReferences,
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

describe("managed context publication projection", () => {
  it("atomically records a reference and removes its complete standalone comment line", () => {
    const comment = managedContextReferenceComment(documents[0]!);
    const result = `The requested change is complete.\n\n  ${comment}  `;

    expect(projectManagedContextReferences(result, documents)).toEqual({
      referencedDocuments: documents,
      publicationContent: "The requested change is complete.\n\n",
    });
  });

  it("removes standalone or inline empty HTML residue from publication", () => {
    expect(projectManagedContextReferences("완료했습니다.\n\n<!--  -->\n", documents)).toEqual({
      referencedDocuments: [],
      publicationContent: "완료했습니다.\n\n",
    });
    expect(projectManagedContextReferences("완료 <!-- -->했습니다.", documents)).toEqual({
      referencedDocuments: [],
      publicationContent: "완료 했습니다.",
    });
  });

  it("rejects a known token in prose instead of leaving an empty comment shell", () => {
    const known = managedContextReferenceToken(documents[0]!);

    expect(() =>
      projectManagedContextReferences(`Used <!-- ${known} --> inline.`, documents),
    ).toThrowError(
      expect.objectContaining<Partial<ManagedContextReferenceError>>({
        code: "reference_not_standalone",
      }),
    );
  });

  it("preserves marker examples in fenced and inline code without claiming a reference", () => {
    const comment = managedContextReferenceComment(documents[0]!);
    const result = [`Example: \`${comment}\``, "", "```md", comment, "```", ""].join("\n");

    expect(projectManagedContextReferences(result, documents)).toEqual({
      referencedDocuments: [],
      publicationContent: result,
    });
  });

  it("retains unknown reference tokens without turning them into evidence", () => {
    const unknown = `lervo-e4:doc_unknown1:sha256:${"b".repeat(64)}`;
    const result = `Retained ${unknown}.`;

    expect(projectManagedContextReferences(result, documents)).toEqual({
      referencedDocuments: [],
      publicationContent: result,
    });
  });
});
