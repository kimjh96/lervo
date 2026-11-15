import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parseAst } from "vitest/node";
import { afterEach, beforeEach, expect, it } from "vitest";

import base from "../../../vitest.config.ts";
import ciConfiguration from "../ci-vitest.config.mjs";
import { createBarrelExportOrigins } from "../lib/test-barrel-export-origins.mjs";
import {
  directBarrelImports,
  directImportDeclaration,
} from "../lib/test-direct-barrel-imports.mjs";
import { examplePackage, writeFiles } from "./fixtures/direct-barrel-package.mjs";

let root;
const at = (path) => resolve(root, path);

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), "lervo-direct-barrel-"));
  writeFiles(root, examplePackage);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("rewrites resolved names, keeps the rest on the barrel, and preserves line count", () => {
  const origins = createBarrelExportOrigins();
  const importer = at("packages/consumer/src/consumer.ts");
  const code = [
    "import fallback, {",
    "  value,",
    "  publicName as alias,",
    "  local,",
    "  more",
    '} from "@lervo/example";',
    "value(alias, local, more, fallback);",
  ].join("\n");
  const [declaration] = parseAst(code).body;
  const replacement = directImportDeclaration({
    code,
    declaration,
    importer,
    barrel: at("packages/example/src/index.ts"),
    origins,
  });
  expect(replacement?.code).toBe(
    [
      'import { value } from "../../example/src/values.ts";',
      'import { renamed as alias } from "../../example/src/renamed.ts";',
      'import { more } from "../../example/src/more.ts";',
      'import fallback, { local } from "@lervo/example";',
    ].join(" ") + "\n".repeat(5),
  );
  // Star resolution reads every star target: any of them could make a name ambiguous.
  expect(replacement?.consulted).toEqual(
    ["index", "values", "more", "left", "right", "nested/index", "nested/deep", "renamed"]
      .map((name) => at(`packages/example/src/${name}.ts`))
      .sort(),
  );
  const namespace = 'import * as all from "@lervo/example";';
  expect(
    directImportDeclaration({
      code: namespace,
      declaration: parseAst(namespace).body[0],
      importer,
      barrel: at("packages/example/src/index.ts"),
      origins,
    }),
  ).toBeNull();
});

/** Drives the plugin as Vitest does: resolved config, project setup files, then transforms. */
function vitestPlugin({ setupFiles = [], globalSetup = [], reportSetup = true } = {}) {
  const plugin = directBarrelImports();
  plugin.configResolved({
    root,
    resolve: {
      alias: [{ find: "@lervo/example", replacement: at("packages/example/src/index.ts") }],
    },
  });
  if (reportSetup) plugin.configureVitest({ project: { config: { setupFiles, globalSetup } } });
  const warnings = [];
  const context = { parse: (code) => parseAst(code), warn: (message) => warnings.push(message) };
  const transform = (path, code) => plugin.transform.call(context, code, at(path));
  return { plugin, transform, warnings };
}

const consumer = "packages/consumer/src/consumer.ts";
const consumerCode = 'import { more, deep } from "@lervo/example";\nmore(deep);\n';

it("records every module a rewrite consulted as an input of the rewritten module", () => {
  const { plugin, transform } = vitestPlugin();
  const result = transform(consumer, consumerCode);
  expect(result?.code).toBe(
    'import { more } from "../../example/src/more.ts"; import { deep } from "../../example/src/nested/deep.ts";\nmore(deep);\n',
  );
  const consulted = ["index", "values", "more", "left", "right", "nested/index", "nested/deep"].map(
    (name) => at(`packages/example/src/${name}.ts`),
  );
  expect(plugin.api.ciTestModuleInputs()).toEqual(new Map([[at(consumer), consulted.sort()]]));
  // A module without a rewrite reads nothing on its behalf.
  expect(
    transform("packages/other/src/other.ts", 'import { local } from "@lervo/example";\n'),
  ).toBeNull();
  expect([...plugin.api.ciTestModuleInputs().keys()]).toEqual([at(consumer)]);
});

it("keeps the barrel import when a test binds the barrel's namespace beside a default", () => {
  writeFiles(root, {
    "packages/example/test/spy.test.ts":
      'import fallback, * as example from "@lervo/example";\nvi.spyOn(example, "more");\n',
  });
  expect(vitestPlugin().transform(consumer, consumerCode)).toBeNull();
});

it("keeps the barrel import when a test assigns the barrel from a dynamic import", () => {
  writeFiles(root, {
    "packages/example/test/spy.test.ts":
      'let example;\nexample = await import("@lervo/example");\nvi.spyOn(example, "more");\n',
  });
  expect(vitestPlugin().transform(consumer, consumerCode)).toBeNull();
});

it("keeps the barrel import when a configured setup file outside test paths mocks it", () => {
  writeFiles(root, { "tools/setup/mocks.mjs": 'vi.mock("@lervo/example");\n' });
  const setup = { setupFiles: [at("tools/setup/mocks.mjs")] };
  expect(vitestPlugin(setup).transform(consumer, consumerCode)).toBeNull();
  const global = { globalSetup: [at("tools/setup/mocks.mjs")] };
  expect(vitestPlugin(global).transform(consumer, consumerCode)).toBeNull();
  expect(vitestPlugin().transform(consumer, consumerCode)).not.toBeNull();
});

it("rewrites nothing when Vitest never reported the setup files it runs", () => {
  const { transform, warnings } = vitestPlugin({ reportSetup: false });
  expect(transform(consumer, consumerCode)).toBeNull();
  expect(warnings).toEqual([expect.stringMatching(/setup files are unknown/u)]);
});

it("loads only in the CI shard configuration, whose ledger reporter reads its inputs", () => {
  const names = (configuration) => (configuration.plugins ?? []).map((plugin) => plugin.name);
  // A single-file run would pay the pin scan's fixed cost without the shard-wide saving.
  expect(names(base)).not.toContain("lervo:direct-barrel-imports");
  const plugin = ciConfiguration.plugins.find(
    (entry) => entry.name === "lervo:direct-barrel-imports",
  );
  expect(plugin?.api.ciTestModuleInputs()).toEqual(new Map());
});
