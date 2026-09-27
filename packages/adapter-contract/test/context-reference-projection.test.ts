import type { AdapterContextEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  ManagedContextReferenceError,
  managedContextReferenceComment,
  managedContextReferenceToken,
  projectManagedContextReferences,
  projectManagedJsonContextReferences,
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

describe("structured managed context publication projection", () => {
  it("projects decoded standalone comments atomically and deduplicates references", () => {
    const comment = managedContextReferenceComment(documents[0]!);
    const result = JSON.stringify({
      operation: "prepare_publication",
      rationale: `The accepted result passed review.\n\n${comment}`,
      details: { accepted: true, checks: [`Verified.\n${comment}`] },
    });
    expect(() => projectManagedContextReferences(result, documents)).toThrow();
    const projected = projectManagedJsonContextReferences(result, documents);
    expect(projected.referencedDocuments).toEqual(documents);
    expect(JSON.parse(projected.publicationContent)).toEqual({
      operation: "prepare_publication",
      rationale: "The accepted result passed review.\n\n",
      details: { accepted: true, checks: ["Verified.\n"] },
    });
  });

  it("preserves exact JSON bytes when no projection changes a string", () => {
    const result = '{ "rationale": "Verified", "checks": [true, 0, null] }';
    expect(projectManagedJsonContextReferences(result, documents)).toEqual({
      referencedDocuments: [],
      publicationContent: result,
    });
  });

  it("changes only string values while retaining number lexemes and duplicate keys", () => {
    const comment = managedContextReferenceComment(documents[0]!);
    const value = JSON.stringify(`Verified.\n${comment}`);
    const prefix = '{ "n": 9007199254740993, "n": 1e400, "quote": "\\\"", "rationale": ';
    const projected = projectManagedJsonContextReferences(`${prefix}${value} }`, documents);
    expect(projected.referencedDocuments).toEqual(documents);
    expect(projected.publicationContent).toBe(`${prefix}${JSON.stringify("Verified.\n")} }`);
  });

  it("rejects malformed JSON and inline references without publishing partial evidence", () => {
    expect(() => projectManagedJsonContextReferences("not JSON", documents)).toThrowError(
      expect.objectContaining({ code: "json_parse_failed" }),
    );
    const comment = managedContextReferenceComment(documents[0]!);
    expect(() =>
      projectManagedJsonContextReferences(
        JSON.stringify({
          accepted: `Verified.\n${comment}`,
          invalid: `Inline ${comment} metadata.`,
        }),
        documents,
      ),
    ).toThrowError(expect.objectContaining({ code: "reference_not_standalone" }));
  });
});
