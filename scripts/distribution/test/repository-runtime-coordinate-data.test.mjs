import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { repositoryRuntimeValidationPlugin } from "../lib/repository-runtime-validation.mjs";

const repository = resolve(import.meta.dirname, "../../..");
const { build } = createRequire(resolve(repository, "packages/schemas/package.json"))("esbuild");

it("bundles only canonical coordinate branches for owned parsing and preserves JSON verdicts", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-coordinate-bundle-"));
  try {
    const built = await build({
      absWorkingDir: repository,
      entryPoints: ["packages/schemas/dist/parse-event-writer-coordinate.js"],
      outfile: resolve(root, "parser.mjs"),
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22.13",
      metafile: true,
      plugins: [repositoryRuntimeValidationPlugin(repository)],
      logLevel: "silent",
    });
    const inputs = Object.keys(built.metafile.inputs);
    expect(inputs.some((path) => path.endsWith("generated/coordinate-data-validators.js"))).toBe(
      true,
    );
    expect(inputs.some((path) => path.endsWith("generated/validators.js"))).toBe(false);
    expect(inputs.some((path) => path.endsWith("dist/coordinate-data-validation.js"))).toBe(false);
    const program = `
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [root,repository]=process.argv.slice(2);
const {parseEventWriterCoordinateJson:parse}=await import(pathToFileURL(root+'/parser.mjs'));
const {validateSchema}=await import(pathToFileURL(repository+'/packages/schemas/dist/validate.js'));
let cases=0;
function compare(value){const text=JSON.stringify(value);assert.deepEqual(parse(text),validateSchema('eventWriterCoordinate',JSON.parse(text)).valid?value:null);cases++;}
function mutations(value){const variants=[null,true,false,0,1,7,1.5,'','bad',[],{}];if(value===null||typeof value!=='object')return variants;for(const key of Object.keys(value)){const missing=structuredClone(value);delete missing[key];variants.push(missing);for(const child of mutations(value[key])){const changed=structuredClone(value);changed[key]=child;variants.push(changed)}}return variants;}
for(let v=1;v<=6;v++){
const value={schemaVersion:Math.max(1,v-1),projectId:'prj_coordinate',selectedEventSchemaVersion:v,activationEvidence:v===1?null:{activationId:'evact_'+'a'.repeat(24),observedAt:'2026-10-12T00:00:00Z',configurationHash:'sha256:'+'a'.repeat(64),readers:[{readerId:'reader_coordinate',readerKind:'local',peerIdentityHash:null,capabilities:{schemaVersion:1,capability:'event_reader',readableEventSchemaVersions:[1,2,3,4,5,6]}}]}};
assert.ok(validateSchema('eventWriterCoordinate',value).valid);compare(value);for(const changed of mutations(value))compare(changed);compare({...value,unexpected:true});
}
assert.throws(()=>parse('{'),SyntaxError);
console.log(JSON.stringify({cases}));
`;
    const script = resolve(root, "compare.mjs");
    await writeFile(script, program);
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ["--disallow-code-generation-from-strings", script, root, repository],
        { encoding: "utf8" },
      ),
    );
    expect(result.cases).toBeGreaterThan(1000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
