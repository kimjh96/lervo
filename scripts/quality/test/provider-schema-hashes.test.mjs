import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  findProviderSchemaIssues,
  hashLikeName,
  inspectProviderSchemaHashes,
} from "../lib/provider-schema-hashes.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "lervo-provider-schema-hashes-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const allowlist = (extra = {}) => ({
  schemaVersion: 1,
  scope: ["packages"],
  nonProviderScopes: [],
  entries: [],
  ...extra,
});

const names = (code) => findProviderSchemaIssues(code).map((issue) => issue.name);
const wrap = (schema) => `const schema = providerOutputSchema(${schema});\n`;

describe("provider schema guard (ADR-0608)", () => {
  it("names a value a model would copy back by its last word, not by a suffix", () => {
    for (const name of [
      "planHash",
      "sourceContentHash",
      "outputHashes",
      "dependencyDigest",
      "headSha",
      "sha256",
      "fileFingerprint",
      "checksum",
      "baseRevision",
      "objectOid",
      "head_ref",
      "parentRefs",
    ])
      expect(hashLikeName(name), name).toBe(true);
    for (const name of ["avoid", "reference", "references", "preference", "revisionCount", "href2"])
      expect(hashLikeName(name), name).toBe(false);
  });

  it("rejects hash names, also shorthand, in properties and required", () => {
    expect(
      names(
        wrap(
          '{ type: "object", properties: { planHash: {}, "sourceDigest": {}, headRef, nested: { properties: { fileFingerprint: {} } } }, required: ["planHash", "baseRevision"] }',
        ),
      ),
    ).toEqual([
      "baseRevision",
      "fileFingerprint",
      "headRef",
      "planHash",
      "planHash",
      "sourceDigest",
    ]);
  });

  it("fails a schema outside the helper, even without siblings or inside Object.assign", () => {
    expect(names("const a = { properties: { ok: {} } };\n")).toEqual([
      "<schema outside providerOutputSchema>",
    ]);
    expect(
      names("const a = providerOutputSchema(Object.assign({}, { properties: { ok: {} } }));\n"),
    ).toEqual(["<unchecked Object.assign schema>"]);
    expect(names("const a = { properties };\n")).toEqual([
      "<properties built at runtime>",
      "<schema outside providerOutputSchema>",
    ]);
  });

  it("reads template literals and regular expressions with quotes exactly", () => {
    // A regex literal with a quote once hid the schema after it from a regex scan.
    const code = [
      "const pattern = /\"[^']*'/u;",
      "const text = `a ${'b'} \" '`;",
      wrap('{ type: "object", properties: { [`dynamic`]: {}, planHash: {} } }'),
    ].join("\n");
    expect(names(code)).toEqual(["<unchecked [`dynamic`]: {}>", "planHash"]);
  });

  it("fails every shape it cannot read, Zod, and hash values", () => {
    const hex = "a".repeat(40);
    expect(
      names(
        [
          'import { z } from "zod";',
          wrap('{ type: "object", properties: Object.fromEntries(list) }'),
          wrap('{ type: "object", properties: { ...other, ok: {} }, required: names }'),
          "return { ...schema, properties: { ok: {} } };",
          wrap(`{ properties: { at: { enum: ["${hex}"], const: \`sha256:${"b".repeat(64)}\` } } }`),
        ].join("\n"),
      ),
    ).toEqual([
      "<zod>",
      "<properties built at runtime>",
      "<required built at runtime>",
      "<unchecked ...other>",
      "<schema outside providerOutputSchema>",
      "<unchecked spread schema>",
      "<hash value aaaaaaaaaaaa…>",
      "<hash value sha256:bbbbb…>",
    ]);
  });

  it("scans non-provider scopes, holding only their helper schemas to the rules", async () => {
    const repositoryRoot = await fixture({
      "packages/schemas/src/event.ts":
        'export const eventSchema = { type: "object", properties: { previousHash: {} } };\n' +
        wrap('{ type: "object", properties: { sourceDigest: {} } }'),
      "packages/a/test/review.test.ts": "const schema = { properties: { planHash: {} } };\n",
    });
    const { issues } = await inspectProviderSchemaHashes({
      repositoryRoot,
      allowlist: allowlist({
        nonProviderScopes: [
          { path: "packages/schemas/src", reason: "Event schemas Lervo writes." },
        ],
      }),
    });
    expect(issues).toEqual([
      "packages/schemas/src/event.ts:2 asks a provider for sourceDigest; Lervo binds hashes and identifiers itself (ADR-0608), so build the schema through providerOutputSchema with literal names, or list it with a reason.",
    ]);
  });

  it("refuses a way around the brand in a non-provider scope; only the helper's file names it", async () => {
    const bypasses = [
      'export const forged = { type: "object", __providerOutputSchema: true };',
      "export const cast = {} as ProviderOutputSchema;",
      "export const parsed = { schema: JSON.parse(text) };",
      'export const marked = { enum: ["docs/a.md"], "x-lervo-ref-kind": "path" };',
    ].join("\n");
    const repositoryRoot = await fixture({
      "packages/schemas/src/event.ts": `${bypasses}\n`,
      "packages/schemas/src/provider-output-schema.ts": `${[0, 1, 3].map((line) => bypasses.split("\n")[line]).join("\n")}\n`,
    });
    const scopes = [{ path: "packages/schemas/src", reason: "Event schemas Lervo writes." }];
    const { issues } = await inspectProviderSchemaHashes({
      repositoryRoot,
      allowlist: allowlist({ nonProviderScopes: scopes }),
    });
    expect(issues.map((issue) => issue.split(" asks a provider for ")).sort()).toEqual([
      [
        "packages/schemas/src/event.ts:1",
        expect.stringMatching(/^<forged ProviderOutputSchema brand>/u),
      ],
      [
        "packages/schemas/src/event.ts:2",
        expect.stringMatching(/^<cast to ProviderOutputSchema>/u),
      ],
      ["packages/schemas/src/event.ts:3", expect.stringMatching(/^<schema from JSON.parse>/u)],
      [
        "packages/schemas/src/event.ts:4",
        expect.stringMatching(/^<reference kind mark outside providerReferenceEnum>/u),
      ],
    ]);
  });

  it("accepts a reviewed construction or name with a reason, and fails a stale or unexplained one", async () => {
    const repositoryRoot = await fixture({
      "packages/a/src/payload.ts": 'const identify = { properties: { os: "x" } };\n',
      "packages/a/src/probe.ts": wrap('{ type: "object", properties: { nonceDigest: {} } }'),
      "packages/a/src/zod.ts": 'import { z } from "zod";\n',
    });
    const entry = {
      path: "packages/a/src/probe.ts",
      property: "nonceDigest",
      reason: "The probe echoes a nonce Lervo chose, by design.",
    };
    const reviewed = await inspectProviderSchemaHashes({
      repositoryRoot,
      allowlist: allowlist({
        entries: [entry, { ...entry, property: "otherHash" }],
        constructions: [
          {
            path: "packages/a/src/payload.ts",
            symbol: "identify",
            reason: "A third-party payload, not a schema.",
          },
          { path: "packages/a/src/zod.ts", symbol: "<module>", reason: "" },
          {
            path: "packages/a/src/payload.ts",
            symbol: "gone",
            reason: "Once built a schema here.",
          },
        ],
      }),
    });
    expect(reviewed.issues).toEqual([
      "packages/a/src/zod.ts#<module> needs a reason for building schemas in the allowlist.",
      "packages/a/src/payload.ts#gone builds no schema any more; remove its allowlist entry.",
      "packages/a/src/probe.ts no longer asks for otherHash; remove its allowlist entry.",
    ]);
  });

  it("fails a cast to the brand, a parsed schema, and hashes in defaults, examples and patterns", () => {
    const hex = "e".repeat(40);
    expect(
      names(
        [
          "const a = value as ProviderOutputSchema;",
          "const b = { ...value, __providerOutputSchema: true };",
          "run({ structuredOutputSchema: JSON.parse(text) });",
          wrap(
            `{ properties: { at: { default: "${hex}", examples: ["${hex}"], pattern: "${hex}" } } }`,
          ),
        ].join("\n"),
      ),
    ).toEqual([
      "<cast to ProviderOutputSchema>",
      "<forged ProviderOutputSchema brand>",
      "<schema from JSON.parse>",
      "<hash value eeeeeeeeeeee…>",
      "<hash value eeeeeeeeeeee…>",
      "<hash value eeeeeeeeeeee…>",
    ]);
  });

  it("allows an exception for one symbol, never the rest of its file", async () => {
    const repositoryRoot = await fixture({
      "packages/a/src/two.ts":
        'const identify = { properties: { os: "x" } };\nconst other = { properties: { ok: {} } };\n',
    });
    const { issues } = await inspectProviderSchemaHashes({
      repositoryRoot,
      allowlist: allowlist({
        constructions: [
          { path: "packages/a/src/two.ts", symbol: "identify", reason: "A third-party payload." },
        ],
      }),
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(
      "two.ts:2 asks a provider for <schema outside providerOutputSchema>",
    );
  });
});
