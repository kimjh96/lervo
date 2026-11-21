import { expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { providerNativeResponseSchema } from "@lervo/repository-knowledge-compiler";

import { canonicalAssessmentContract } from "../src/canonical-assessment-contract.js";

const invalid = expect.objectContaining({ code: "knowledge_semantic_review_invalid" });
const rationale =
  "The exact source must preserve the existing independently documented local execution requirement without inventing new changes.";

function text(path: string, content: string) {
  return { path, contentHash: sha256(content), kind: "text" as const, content };
}

function document(path: string, content: string) {
  return { path, role: "canonical_candidate" as const, contentHash: sha256(content), content };
}

it("rejects an unchanged draft as a canonical change instead of starting an empty integration", () => {
  const content = "# Runtime\n\nLocal execution remains available without a Hub.\n";
  const source = text("docs/specs/runtime.md", content);
  const contract = canonicalAssessmentContract({
    sources: [source],
    context: [],
    capturedSources: [source],
  });
  const decision = {
    source: "s1",
    sourcePath: source.path,
    disposition: "candidate",
    rationale,
    canonicalReferences: [],
  };
  expect(() =>
    contract.parse({ decisions: [decision], drafts: [{ path: source.path, content }] }),
  ).toThrowError(invalid);
  expect(
    contract.parse({ decisions: [{ ...decision, disposition: "no_change" }], drafts: [] }).drafts,
  ).toEqual([]);
});

it("replaces an existing target only from bytes the call showed, and derives its beforeHash", () => {
  const source = { path: "src/runtime.ts", contentHash: sha256("v2"), kind: "text" as const };
  const target = { path: "docs/foundation/gates.md", contentHash: sha256("# Existing gates\n") };
  const decision = {
    source: "s1",
    sourcePath: source.path,
    disposition: "candidate",
    rationale,
    canonicalReferences: [],
  };
  const answer = (path: string) => ({
    decisions: [decision],
    drafts: [{ path, content: "# Revised gates\n" }],
  });
  const unseen = canonicalAssessmentContract({
    sources: [source],
    context: [],
    capturedSources: [source, target],
  });
  // The generator never saw the existing target's bytes, so it cannot replace them.
  expect(() => unseen.parse(answer(target.path))).toThrowError(invalid);
  // A new target has no beforeHash.
  expect(unseen.parse(answer("docs/foundation/new-gates.md")).drafts[0]?.beforeHash).toBeNull();
  // The retry shows the target's exact bytes; Lervo then binds the captured hash itself.
  const retry = canonicalAssessmentContract({
    sources: [source],
    context: [],
    capturedSources: [source, target],
    draftTargets: [{ ...target, content: "# Existing gates\n" }],
  });
  expect(retry.parse(answer(target.path)).drafts[0]?.beforeHash).toBe(target.contentHash);
  expect(JSON.stringify(retry.view)).not.toContain("sha256:");
});

it("cites sources and context by reference and maps them back to exact hashes (ADR-0604)", () => {
  const sources = [
    text("src/a.ts", "export const a = 1;\n"),
    text("src/b.ts", "export const b = 2;\n"),
  ];
  const quote = "Local execution works without a Hub.";
  const context = [document("docs/specs/runtime.md", `# Runtime\n\n${quote}\n`)];
  const contract = canonicalAssessmentContract({ sources, context, capturedSources: sources });
  // Nothing in the view is a hash the generator could copy back.
  expect(JSON.stringify(contract.view)).not.toContain("sha256:");
  const native = providerNativeResponseSchema(contract.schema) as {
    properties: { decisions: { items: { properties: Record<string, unknown> } } };
  };
  const item = native.properties.decisions.items.properties;
  expect(item.source).toEqual({ enum: ["s1", "s2"] });
  // ADR-0608: a path enum carries its kind, which only the provider boundary removes.
  expect(item.sourcePath).toEqual({ enum: ["src/a.ts", "src/b.ts"], "x-lervo-ref-kind": "path" });
  expect(
    (item.canonicalReferences as { items: { properties: Record<string, unknown> } }).items
      .properties,
  ).toMatchObject({ document: { enum: ["c1"] }, path: { enum: ["docs/specs/runtime.md"] } });
  const covered = (source: string, sourcePath: string) => ({
    source,
    sourcePath,
    disposition: "covered",
    rationale,
    canonicalReferences: [{ document: "c1", path: "docs/specs/runtime.md", quote }],
  });
  const parsed = contract.parse({
    decisions: [covered("s2", "src/b.ts"), covered("s1", "src/a.ts")],
    drafts: [],
  });
  expect(parsed.decisions.map((decision) => [decision.path, decision.contentHash])).toEqual(
    sources.map((source) => [source.path, source.contentHash]),
  );
  expect(parsed.decisions[0]!.canonicalReferences).toEqual([
    { path: "docs/specs/runtime.md", contentHash: context[0]!.contentHash, quote },
  ]);
  // A valid reference paired with another source's path, a garbled reference and a duplicate.
  for (const decisions of [
    [covered("s1", "src/b.ts"), covered("s2", "src/b.ts")],
    [covered("s1", "src/a.ts"), covered("s9", "src/b.ts")],
    [covered("s1", "src/a.ts"), covered("s1", "src/a.ts")],
  ])
    expect(() => contract.parse({ decisions, drafts: [] })).toThrowError(invalid);
});

it("emits no empty enum when there is no context to quote", () => {
  const source = text("src/a.ts", "export const a = 1;\n");
  const contract = canonicalAssessmentContract({
    sources: [source],
    context: [],
    capturedSources: [source],
  });
  expect(JSON.stringify(contract.schema)).not.toContain('"enum":[]');
  const decision = {
    source: "s1",
    sourcePath: source.path,
    disposition: "no_change",
    rationale,
    canonicalReferences: [{ document: "c1", path: "docs/x.md", quote: "a quote of twenty chars" }],
  };
  expect(() => contract.parse({ decisions: [decision], drafts: [] })).toThrowError(invalid);
});
