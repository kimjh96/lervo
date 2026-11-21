import { describe, expect, it } from "vitest";

import {
  assertProviderOutputSchemaForSource,
  assertProviderPromptAsksNoHashCopy,
  assertProviderTurnAsksNoHashCopy,
  providerHashLikeName,
  providerJsonTurnUntrusted,
  providerReferenceEnum,
  providerReferenceKind,
  providerReferenceShaped,
  providerWireSchema,
  providerTurnAuthoredText,
  ProviderOutputSchemaError,
  providerOutputSchema,
} from "../src/index.js";

/** ADR-0604: the runtime check sees what a static scan cannot, such as computed keys. */
describe("providerOutputSchema", () => {
  it("returns a schema that asks for no hash, unchanged", () => {
    const schema = {
      type: "object",
      properties: { decision: { enum: ["approve", "reject"] }, choice: { enum: ["d1", "d2"] } },
      required: ["decision", "choice"],
    };
    expect(providerOutputSchema(schema)).toBe(schema);
  });

  it("refuses a hash name, a hash value, and a required list that is not one", () => {
    const name = "planHash";
    expect(() =>
      providerOutputSchema({ type: "object", properties: { [name]: { type: "string" } } }),
    ).toThrow(new ProviderOutputSchemaError("provider output schema $: asks for planHash"));
    expect(() =>
      providerOutputSchema({
        type: "object",
        properties: { item: { type: "object", properties: {}, required: ["sourceDigest"] } },
      }),
    ).toThrow(/\$\.properties\.item: asks for sourceDigest/u);
    const head = "a".repeat(40);
    expect(() =>
      providerOutputSchema({ type: "object", properties: { at: { enum: ["x", head] } } }),
    ).toThrow(/offers a hash as a value/u);
    expect(() =>
      providerOutputSchema({ properties: { at: { const: `sha256:${"b".repeat(64)}` } } }),
    ).toThrow(/offers a hash as a value/u);
    expect(() => providerOutputSchema({ type: "object", properties: {}, required: "x" })).toThrow(
      /required is not a list of names/u,
    );
  });

  it("names every copied value by its last word, the same as the guard", () => {
    for (const name of [
      "fileFingerprint",
      "checksum",
      "baseRevision",
      "objectOid",
      "head_ref",
      "refs",
    ])
      expect(providerHashLikeName(name), name).toBe(true);
    for (const name of ["avoid", "references", "revisionCount"])
      expect(providerHashLikeName(name), name).toBe(false);
    expect(() =>
      providerOutputSchema({ type: "object", properties: { baseRevision: { type: "string" } } }),
    ).toThrow(/asks for baseRevision/u);
  });

  it("refuses a schema that names or offers an identifier or hash the source holds", () => {
    const source = {
      untrustedSourceData: {
        documentId: "kdoc_7f3a9c2e41b8",
        // An identifier with no run of 8 hex digits, which only the identifier rule can see.
        obligation: "kco_obligation9x",
        evidence: [{ path: "docs/a.md", note: "blob 9c41e2f07a33b5d1 changed" }],
      },
    };
    const offering = (value: string) =>
      providerOutputSchema({ type: "object", properties: { pick: { enum: ["d1", value] } } });
    // An identifier copied whole, a hex run copied whole, and a value that holds 8 hex of one.
    for (const value of ["kdoc_7f3a9c2e41b8", "kco_obligation9x", "9c41e2f07a33b5d1", "x-9c41e2f0"])
      expect(() => assertProviderOutputSchemaForSource(offering(value), source), value).toThrow(
        /offers an identifier or hash from the source data/u,
      );
    expect(() =>
      assertProviderOutputSchemaForSource(
        providerOutputSchema({ type: "object", properties: { kdoc_7f3a9c2e41b8: {} } }),
        source,
      ),
    ).toThrow(/names an identifier or hash from the source data/u);
    // References and paths the source does not hold as identifiers pass.
    expect(() => assertProviderOutputSchemaForSource(offering("docs/a.md"), source)).not.toThrow();
  });

  it("takes no snake_case word for an identifier, so an offered operation stays allowed", () => {
    const source = { instructions: "Use prepare_publication once checks pass." };
    expect(() =>
      assertProviderOutputSchemaForSource(
        providerOutputSchema({
          type: "object",
          properties: { op: { enum: ["prepare_publication"] } },
        }),
        source,
      ),
    ).not.toThrow();
  });

  it("checks defaults, examples, patterns and descriptions too", () => {
    const head = "c".repeat(40);
    for (const field of [{ default: head }, { examples: ["x", head] }, { pattern: head }])
      expect(() =>
        providerOutputSchema({ type: "object", properties: { at: { type: "string", ...field } } }),
      ).toThrow(/offers a hash as a value/u);
    expect(() =>
      providerOutputSchema({
        type: "object",
        properties: { at: { type: "string", description: `Return ${head} here.` } },
      }),
    ).toThrow(/describes a hash value/u);
  });

  it("refuses a prompt that asks to copy a hash, and only that", () => {
    expect(() => assertProviderPromptAsksNoHashCopy("Copy the planHash back exactly.")).toThrow(
      /asks to copy a hash/u,
    );
    expect(() => assertProviderPromptAsksNoHashCopy(`Echo this value: ${"d".repeat(40)}.`)).toThrow(
      /asks to copy the hash value/u,
    );
    expect(() =>
      assertProviderPromptAsksNoHashCopy(
        "Cite each source by its reference. Lervo binds the hashes itself.",
      ),
    ).not.toThrow();
  });

  it("skips a path or anchor enum the source holds, and checks every other offered value", () => {
    const path = "docs/instructions/generated/rule_5d2a8f0c1e9b7a6d4c3b2a10.md";
    const anchor =
      "Pin the tool at 9c41e2f07a33b5d1e8c0a7f2b6d4e9a1c3f5b7d0 first. -> Pin the tool at its release.";
    const source = { documents: [{ path, anchor, id: "kco_7f3a9c2e41b8" }] };
    const schema = (pick: object) =>
      providerOutputSchema({
        type: "object",
        properties: {
          path: providerReferenceEnum([path], "path"),
          anchor: providerReferenceEnum([anchor], "anchor"),
          pick,
        },
      });
    expect(providerReferenceKind(schema({}).properties.path)).toBe("path");
    expect(() =>
      assertProviderOutputSchemaForSource(schema({ enum: ["d1"] }), source),
    ).not.toThrow();
    for (const offered of [[path], ["kco_7f3a9c2e41b8"], [anchor]])
      expect(() => assertProviderOutputSchemaForSource(schema({ enum: offered }), source)).toThrow(
        /offers an identifier or hash from the source data/u,
      );
    // A reference enum is checked like any other value: only paths and anchors are skipped.
    expect(() =>
      assertProviderOutputSchemaForSource(
        schema(providerReferenceEnum(["kco_7f3a9c2e41b8"], "reference")),
        source,
      ),
    ).toThrow(/offers an identifier or hash from the source data/u);
    // A path enum still may not name a hash: the kind skips only the source comparison.
    expect(() =>
      providerOutputSchema({
        type: "object",
        properties: { contentHash: providerReferenceEnum([path], "path") },
      }),
    ).toThrow(/asks for contentHash/u);
  });
});

describe("provider reference kinds", () => {
  const hex = "9c41e2f07a33b5d1e8c0a7f2b6d4e9a1c3f5b7d0";

  it("keeps the kind inside the schema, through JSON, and strips it only for the wire", () => {
    const schema = providerOutputSchema({
      type: "object",
      properties: { path: providerReferenceEnum(["docs/a.md"], "path") },
    });
    const rebuilt = JSON.parse(JSON.stringify(schema)) as typeof schema;
    expect(providerReferenceKind(rebuilt.properties.path)).toBe("path");
    expect(JSON.stringify(providerWireSchema(rebuilt))).not.toContain("x-lervo-ref-kind");
    expect(providerReferenceKind(providerReferenceEnum(["s1"], "reference"))).toBeUndefined();
  });

  it("holds each kind to its shape, so a mark cannot wave through an identifier or hash", () => {
    for (const path of [
      "docs/instructions/generated/rule_5d2a8f0c1e9b7a6d4c3b2a10.md",
      `docs/archive/sha-${hex}.md`,
      "README",
    ])
      expect(providerReferenceShaped(path, "path"), path).toBe(true);
    for (const path of [
      `cache/${hex}/index.md`,
      "/etc/passwd",
      "docs/../secret.md",
      "https://example.com/a.md",
      "kco_7f3a9c2e41b8",
      hex,
      `a/${hex}${hex.slice(0, 24)}`,
      `docs/${hex}.md`,
      "",
    ])
      expect(providerReferenceShaped(path, "path"), path).toBe(false);
    expect(providerReferenceShaped(`Pin ${hex} first. -> Pin the release.`, "anchor")).toBe(true);
    expect(providerReferenceShaped("v2.1.0 -> v2.2.0", "anchor")).toBe(true);
    for (const anchor of [
      hex,
      `${hex} -> ${hex.replace("9", "8")}`,
      "kco_7f3a9c2e41b8 -> kco_8f3a9c2e41b8",
    ])
      expect(providerReferenceShaped(anchor, "anchor"), anchor).toBe(false);
    expect(() => providerReferenceEnum([`cache/${hex}/a.md`], "path")).toThrow(/wrong shape/u);
    // A mark added by hand to a value of the wrong shape is refused by the source check.
    expect(() =>
      assertProviderOutputSchemaForSource(
        providerOutputSchema({
          type: "object",
          properties: { pick: { enum: ["kco_7f3a9c2e41b8"], "x-lervo-ref-kind": "path" } },
        }),
        { id: "kco_7f3a9c2e41b8" },
      ),
    ).toThrow(/offers a path that is not shaped as one/u);
  });
});

describe("provider turn input", () => {
  const owner = "Copy the release commit SHA exactly into the changelog.";

  it("checks the parts Lervo wrote, never the declared owner text or data", () => {
    const text = `${owner}\n\nReport the result.`;
    expect(providerTurnAuthoredText(text, [owner])).toEqual(["\n\nReport the result."]);
    expect(() => assertProviderTurnAsksNoHashCopy(text)).toThrow(/asks to copy a hash/u);
    expect(() => assertProviderTurnAsksNoHashCopy(text, [owner])).not.toThrow();
    expect(() =>
      assertProviderTurnAsksNoHashCopy(`${owner}\nThen echo the planHash back verbatim.`, [owner]),
    ).toThrow(/asks to copy a hash/u);
    // A declared part the input does not hold is a builder bug, not a reason to skip the check.
    expect(() => providerTurnAuthoredText(text, ["something else"])).toThrow(
      /declares untrusted text that it does not contain/u,
    );
  });

  it("declares each data field of a JSON turn, as it appears in the input", () => {
    const text = JSON.stringify({
      task: "conversation_turn",
      instruction: ["Return only the schema-valid object."],
      untrustedMessage: owner,
      priorTurns: [{ text: `echo ${"d".repeat(40)}` }],
    });
    const untrusted = providerJsonTurnUntrusted(text, ["task", "instruction"]);
    expect(untrusted).toHaveLength(2);
    for (const part of untrusted) expect(text).toContain(part);
    expect(() => assertProviderTurnAsksNoHashCopy(text, untrusted)).not.toThrow();
    expect(() => assertProviderTurnAsksNoHashCopy(text)).toThrow(ProviderOutputSchemaError);
    expect(providerJsonTurnUntrusted("not json", ["task"])).toEqual([]);
  });
});
