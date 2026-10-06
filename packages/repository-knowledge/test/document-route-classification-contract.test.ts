import { defaultDecisionTaxonomy } from "@lervo/project";
import { describe, expect, it } from "vitest";

import {
  createDocumentRouteClassificationRequest,
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

  it("turns missing, mismatched, duplicated, or unknown-route answers into uncertain verdicts", () => {
    const { request } = createDocumentRouteClassificationRequest({
      taxonomy: defaultDecisionTaxonomy,
      documents,
    });
    const rationale = "The document describes how operators restore the running service.";

    const verdicts = interpretDocumentRouteClassificationResponse(request, {
      classifications: [
        {
          path: "notes/a.md",
          contentHash: documents[1]!.contentHash,
          outcome: "route",
          routeId: "operations",
          roleId: null,
          rationale,
        },
        {
          path: "notes/b.md",
          contentHash: documents[0]!.contentHash,
          outcome: "route",
          routeId: "invented",
          roleId: null,
          rationale,
        },
      ],
    });

    expect(verdicts.map((verdict) => [verdict.path, verdict.outcome, verdict.routeId])).toEqual([
      ["notes/a.md", "route", "operations"],
      ["notes/b.md", "uncertain", null],
    ]);
    expect(
      interpretDocumentRouteClassificationResponse(request, { classifications: [] }).map(
        (verdict) => verdict.outcome,
      ),
    ).toEqual(["uncertain", "uncertain"]);
    expect(
      interpretDocumentRouteClassificationResponse(request, {
        classifications: [
          {
            path: "notes/a.md",
            contentHash: sha256("stale bytes"),
            outcome: "retain_in_place",
            routeId: null,
            roleId: null,
            rationale,
          },
        ],
      })[0]!.outcome,
    ).toBe("uncertain");
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
    const verdicts = interpretDocumentRouteClassificationResponse(request, {
      classifications: [
        {
          path: "VISION_NOTES.md",
          contentHash: documents[0]!.contentHash,
          outcome: "role",
          routeId: null,
          roleId: "product_vision",
          rationale,
        },
        {
          path: ".claude/rules/a.md",
          contentHash: documents[1]!.contentHash,
          outcome: "role",
          routeId: null,
          roleId: "product_vision",
          rationale,
        },
      ],
    });
    expect(verdicts.map((verdict) => [verdict.path, verdict.outcome, verdict.roleId])).toEqual([
      [".claude/rules/a.md", "uncertain", null],
      ["VISION_NOTES.md", "role", "product_vision"],
    ]);
  });
});
