import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CSS_SOURCE_UNIT_ADAPTER, extractCssSymbolSpans } from "../src/css-source-units.js";
import { defaultRepositoryKnowledgePolicy } from "../src/policy.js";
import { scanRepositoryKnowledge } from "../src/scanner.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("parser-grade CSS source units", () => {
  it("extracts qualified rules, named at-rules and custom properties with exact UTF-8 ranges", async () => {
    const content = "/* 😀 */\n@layer base {\n  .card, .panel { --tone: red; color: var(--tone); }\n}\n@keyframes spin { from { opacity: 0 } to { opacity: 1 } }\n";
    const spans = extractCssSymbolSpans(content);
    expect(spans.map((span) => span.locator)).toEqual(expect.arrayContaining([
      "css:/at-rule:@layer base",
      "css:/at-rule:@layer base/rule:.card, .panel",
      "css:/at-rule:@layer base/rule:.card, .panel/custom-property:--tone",
      "css:/at-rule:@keyframes spin",
      "css:/at-rule:@keyframes spin/rule:from",
      "css:/at-rule:@keyframes spin/rule:to",
    ]));
    expect(spans.map((span) => content.slice(span.startCharacter, span.endCharacter))).toEqual(expect.arrayContaining([
      "--tone: red;",
      "@keyframes spin { from { opacity: 0 } to { opacity: 1 } }",
    ]));

    const root = await mkdtemp(resolve(tmpdir(), "lervo-css-source-units-"));
    roots.push(root);
    await writeFile(resolve(root, "theme.css"), content);
    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: "prj_csssourceunits",
      policy: defaultRepositoryKnowledgePolicy,
      observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
    });
    const customProperty = scan.units.find((unit) => unit.locator.endsWith("custom-property:--tone"))!;
    expect(customProperty).toMatchObject({ unitKind: "code_symbol", range: { startByte: Buffer.byteLength(content.slice(0, content.indexOf("--tone"))) } });
    expect(CSS_SOURCE_UNIT_ADAPTER).toBe("css-symbol-v1+postcss-8.5.26");
  });

  it("keeps a named sibling version stable and disambiguates valid duplicate selectors", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-css-source-siblings-"));
    roots.push(root);
    const first = ".same { color: red }\n.same { color: blue }\n@keyframes spin { from {opacity:0} to {opacity:1} }\n";
    await writeFile(resolve(root, "theme.css"), first);
    const scan = async () => scanRepositoryKnowledge({ repositoryRoot: root, projectId: "prj_csssiblings", policy: defaultRepositoryKnowledgePolicy, observeRevision: async () => ({ status: "unavailable" as const, reason: "git_head_unavailable" as const }) });
    const before = await scan();
    expect(before.units.filter((unit) => unit.locator.startsWith("css:/rule:.same")).map((unit) => unit.locator)).toEqual([
      "css:/rule:.same/occurrence=0",
      "css:/rule:.same/occurrence=1",
    ]);
    const keyframesBefore = before.units.find((unit) => unit.locator === "css:/at-rule:@keyframes spin")!;
    await writeFile(resolve(root, "theme.css"), first.replace("color: red", "color: green"));
    const after = await scan();
    expect(after.units.find((unit) => unit.locator === keyframesBefore.locator)?.unitVersionId).toBe(keyframesBefore.unitVersionId);
  });

  it("fails closed on CSS syntax errors and excessive nesting", () => {
    expect(() => extractCssSymbolSpans(".broken { color: red"))
      .toThrowError(expect.objectContaining({ code: "knowledge_unit_extraction_failed" }));
    const deep = `${"@media (width > 0px) {".repeat(129)}.x{}${"}".repeat(129)}`;
    expect(() => extractCssSymbolSpans(deep))
      .toThrowError(expect.objectContaining({ code: "knowledge_unit_extraction_failed" }));
  });
});
