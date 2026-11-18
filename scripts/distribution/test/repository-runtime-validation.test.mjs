import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import ts from "typescript";
import { compileSchemaValidators } from "../../../packages/schemas/scripts/compile-validators.mjs";
import { createRuntimeValidatorMap } from "../lib/repository-runtime-validator-map.mjs";
import {
  buildRepositoryRuntimeValidators,
  repositoryRuntimeValidationPlugin,
} from "../lib/repository-runtime-validation.mjs";
const repository = resolve(import.meta.dirname, "../../..");
const { build } = createRequire(resolve(repository, "packages/schemas/package.json"))("esbuild");
const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Compiles the complete validator catalog; shared CI runners take about 50 s for 6 s of local work.
it("keeps selected generated function bodies exactly equal to the full canonical compiler", async () => {
  const compiled = await compileSchemaValidators(resolve(repository, "packages/schemas"));
  function functions(source) {
    const parsed = ts.createSourceFile(
        "validators.cjs",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      ),
      result = new Map();
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name) {
        expect(result.has(node.name.text)).toBe(false);
        result.set(node.name.text, node.getText(parsed));
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    return result;
  }
  const full = functions(compiled.generatedSources.full),
    selected = functions(compiled.generatedSources.selected);
  expect(full.size).toBe(185);
  expect(selected.size).toBe(12);
  for (const [name, body] of selected) expect(body, name).toBe(full.get(name));
  expect(compiled.bytes).toEqual(
    await readFile(resolve(repository, "packages/schemas/dist/generated/validators.js")),
  );
  expect(compiled.selectedBytes).toEqual(
    await readFile(resolve(repository, "packages/schemas/dist/generated/selected-validators.js")),
  );
}, 180_000);

it("never retries invalid selected values and loads the complete map once on an unselected name", () => {
  let loads = 0;
  const invalid = () => false,
    selected = { chosen: invalid },
    full = { other: () => true };
  const map = createRuntimeValidatorMap(selected, () => {
    loads++;
    return full;
  });
  expect(map.chosen(null)).toBe(false);
  expect(loads).toBe(0);
  expect(map.other(null)).toBe(true);
  expect(map.other(null)).toBe(true);
  expect(loads).toBe(1);
});

it("preserves property-key coercion and original lookup failures", () => {
  for (const name of [
    null,
    undefined,
    1,
    Symbol("unknown"),
    "__proto__",
    "toString",
    "constructor",
    "absent",
  ]) {
    const full = { chosen: () => true },
      map = createRuntimeValidatorMap({ chosen: full.chosen }, () => full);
    function result(target) {
      try {
        return target[name](null);
      } catch (error) {
        return [error.name, error.message.replace("target[name]", "validator")];
      }
    }
    expect(result(map)).toEqual(result(full));
  }
  for (const throwing of [false, true]) {
    function call(lazy) {
      const trace = [],
        full = { chosen: () => true };
      const name = {
        [Symbol.toPrimitive](hint) {
          trace.push(hint);
          if (throwing) throw Error("key failed");
          return "chosen";
        },
      };
      const map = lazy ? createRuntimeValidatorMap({ chosen: full.chosen }, () => full) : full;
      try {
        return { result: map[name](null), trace };
      } catch (error) {
        return { error: error.message, trace };
      }
    }
    expect(call(true)).toEqual(call(false));
  }
});

it("runs the actual bundled validation facade with exact errors, lazy fallback and no runtime code generation", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-validation-"));
  roots.push(root);
  await buildRepositoryRuntimeValidators(build, repository, root);
  await build({
    absWorkingDir: repository,
    entryPoints: ["packages/schemas/dist/validate.js"],
    outfile: resolve(root, "repository-runtime.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22.13",
    plugins: [repositoryRuntimeValidationPlugin(repository)],
    logLevel: "silent",
  });
  await writeFile(resolve(root, "package.json"), '{"type":"module"}');
  const code = `import{createRequire}from'node:module';import{readFileSync,readdirSync}from'node:fs';import{pathToFileURL}from'node:url';import assert from'node:assert/strict';const[dir,repo]=process.argv.slice(1),req=createRequire(pathToFileURL(dir+'/repository-runtime.js')),fallback=req.resolve('./repository-runtime-validators.cjs');const candidate=await import(pathToFileURL(dir+'/repository-runtime.js'));assert.equal(req.cache[fallback],undefined);const selected=await import(pathToFileURL(repo+'/packages/schemas/dist/generated/selected-validators.js'));for(const name of Object.keys(selected.default))assert.equal(candidate.validateSchema(name,null).valid,false);assert.equal(req.cache[fallback],undefined);const original=await import(pathToFileURL(repo+'/packages/schemas/dist/validate.js')),full=await import(pathToFileURL(repo+'/packages/schemas/dist/generated/validators.js'));let cases=0;function compare(name,value){assert.deepEqual(candidate.validateSchema(name,value),original.validateSchema(name,value));cases++;}for(const name of Object.keys(full.default))for(const value of [null,false,0,'',[],{},{schemaVersion:1}])compare(name,value);assert.ok(req.cache[fallback]);const fixtures=repo+'/packages/schemas/test/fixtures';for(const file of readdirSync(fixtures).filter(n=>/^(?:valid|invalid)(?:-|\\.)/.test(n)&&n.endsWith('.json')))for(const fixture of JSON.parse(readFileSync(fixtures+'/'+file,'utf8'))){compare(fixture.schema,fixture.value);if(fixture.value&&typeof fixture.value==='object'&&!Array.isArray(fixture.value))for(const key of Object.keys(fixture.value)){const missing={...fixture.value};delete missing[key];compare(fixture.schema,missing);compare(fixture.schema,{...fixture.value,[key]:null});}}const one=candidate.validateSchema('event',null);one.errors[0].message='caller changed';assert.deepEqual(candidate.validateSchema('event',null),original.validateSchema('event',null));console.log(JSON.stringify({cases,schemas:Object.keys(full.default).length}));`;
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--disallow-code-generation-from-strings",
        "--input-type=module",
        "--eval",
        code,
        root,
        repository,
      ],
      { encoding: "utf8" },
    ),
  );
  expect(result.schemas).toBe(185);
  expect(result.cases).toBeGreaterThan(2000);
}, 30000);
