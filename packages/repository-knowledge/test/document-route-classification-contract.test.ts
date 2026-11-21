import { defaultDecisionTaxonomy } from "@lervo/project";
import { describe, expect, it } from "vitest";

import {
  createDocumentRouteClassificationRequest,
  documentRouteClassificationContract,
  documentRouteSetDigest,
  interpretDocumentRouteClassificationResponse,
  sha256,
} from "../src/index.js";

const documents = [
  { path: "notes/b.md", content: "# B\n\nRelease checklist.\n" },
  { path: "notes/a.md", content: "# A\n\nRuntime recovery.\n" },
].map((document) => ({
  subject: "document" as const,
  path: document.path,
  contentHash: sha256(document.content),
  workspacePackage: null,
  content: document.content,
}));

describe("document route classification contract", () => {
  it("binds a deterministic request to the exact routes, bytes, and order-independent documents", () => {
    const first = createDocumentRouteClassificationRequest({
      taxonomy: defaultDecisionTaxonomy,
      documents,
    });
    const second = createDocumentRouteClassificationRequest({
      taxonomy: defaultDecisionTaxonomy,
      documents: [...documents].reverse(),
    });

    expect(first.requestDigest).toBe(second.requestDigest);
    expect(first.request.documents.map((document) => document.path)).toEqual([
      "notes/a.md",
      "notes/b.md",
    ]);
    expect(first.request.routeSetDigest).toBe(documentRouteSetDigest(defaultDecisionTaxonomy));
    expect(first.request.routes).toContainEqual({
      id: "operations",
      path: "operations",
      description: expect.any(String),
    });
    expect(first.request.roles.map((role) => role.roleId)).toEqual([
      "delivery_roadmap",
      "execution_specification",
      "product_vision",
      "system_architecture",
    ]);
    expect(JSON.stringify(first.request)).not.toContain("titleTerms");
  });

  it("shows references, not hashes, and enumerates exactly the documents, routes and roles (ADR-0604)", () => {
    const { request } = createDocumentRouteClassificationRequest({
      taxonomy: defaultDecisionTaxonomy,
      documents,
    });
    const contract = documentRouteClassificationContract(request);
    expect(JSON.stringify(contract.view)).not.toContain("sha256:");
    expect(contract.view.documents.map((document) => [document.document, document.path])).toEqual([
      ["d1", "notes/a.md"],
      ["d2", "notes/b.md"],
    ]);
    const properties = contract.schema.properties.classifications.items.properties;
    expect(properties.document).toEqual({ enum: ["d1", "d2"] });
    // ADR-0608: a path enum carries its kind, which only the provider boundary removes.
    expect(properties.sourcePath).toEqual({
      enum: ["notes/a.md", "notes/b.md"],
      "x-lervo-ref-kind": "path",
    });
    expect(properties.routeId).toMatchObject({
      enum: expect.arrayContaining(["operations", null]),
    });
    expect(properties.roleId).toMatchObject({
      enum: expect.arrayContaining(["product_vision", null]),
    });
  });

  it("maps references back to exact hashes, and throws on a malformed answer instead of guessing", () => {
    const { request } = createDocumentRouteClassificationRequest({
      taxonomy: defaultDecisionTaxonomy,
      documents,
    });
    const rationale = "The document describes how operators restore the running service.";
    const entry = (document: string, sourcePath: string, routeId: string | null) => ({
      document,
      sourcePath,
      outcome: routeId === null ? "uncertain" : "route",
      routeId,
      roleId: null,
      rationale,
    });
    const verdicts = interpretDocumentRouteClassificationResponse(request, {
      classifications: [entry("d2", "notes/b.md", null), entry("d1", "notes/a.md", "operations")],
    });
    // A well-formed `uncertain` is a verdict.
    expect(verdicts.map((verdict) => [verdict.path, verdict.contentHash, verdict.outcome])).toEqual(
      [
        ["notes/a.md", documents[1]!.contentHash, "route"],
        ["notes/b.md", documents[0]!.contentHash, "uncertain"],
      ],
    );
    for (const classifications of [
      [],
      [entry("d1", "notes/a.md", "operations")],
      // A valid reference paired with the other document's path.
      [entry("d1", "notes/b.md", null), entry("d2", "notes/a.md", null)],
      [entry("d1", "notes/a.md", null), entry("d1", "notes/a.md", null)],
      [entry("d1", "notes/a.md", "invented"), entry("d2", "notes/b.md", null)],
    ])
      expect(() =>
        interpretDocumentRouteClassificationResponse(request, { classifications }),
      ).toThrowError(expect.objectContaining({ code: "knowledge_semantic_review_invalid" }));
  });

  it("admits a role only for a document subject and only from the role catalog", () => {
    const { request } = createDocumentRouteClassificationRequest({
      taxonomy: defaultDecisionTaxonomy,
      documents: [
        { ...documents[0]!, path: "VISION_NOTES.md" },
        { ...documents[1]!, subject: "instruction", path: ".claude/rules/a.md" },
      ],
    });
    const rationale = "The document states the long-term product direction for the repository.";
    const role = (document: string, sourcePath: string) => ({
      document,
      sourcePath,
      outcome: "role",
      routeId: null,
      roleId: "product_vision",
      rationale,
    });
    // Requests sort by path: d1 is the instruction, d2 the document.
    expect(
      interpretDocumentRouteClassificationResponse(request, {
        classifications: [
          role("d2", "VISION_NOTES.md"),
          { ...role("d1", ".claude/rules/a.md"), outcome: "uncertain", roleId: null },
        ],
      }).map((verdict) => [verdict.path, verdict.outcome, verdict.roleId]),
    ).toEqual([
      [".claude/rules/a.md", "uncertain", null],
      ["VISION_NOTES.md", "role", "product_vision"],
    ]);
    expect(() =>
      interpretDocumentRouteClassificationResponse(request, {
        classifications: [role("d2", "VISION_NOTES.md"), role("d1", ".claude/rules/a.md")],
      }),
    ).toThrowError(expect.objectContaining({ code: "knowledge_semantic_review_invalid" }));
  });
});
