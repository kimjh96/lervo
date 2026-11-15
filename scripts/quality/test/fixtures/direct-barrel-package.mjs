import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Writes `files` below `root`; shared by the direct barrel import tests. */
export function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), content);
  }
}

/** A source package whose barrel covers every re-export form the plugin resolves or keeps. */
export const examplePackage = {
  "packages/example/src/index.ts": [
    'export * from "./values.js";',
    'export * from "./more.js";',
    'export { renamed as publicName, default as defaultValue } from "./renamed.js";',
    'export * as namespace from "./values.js";',
    'export type { OnlyType } from "./types.js";',
    'import { imported } from "./imported.js";',
    "export { imported };",
    'export * from "./left.js";',
    'export * from "./right.js";',
    'export * from "./nested/index.js";',
    "export const local = 1;",
  ].join("\n"),
  "packages/example/src/values.ts": [
    "export const value = 1;",
    "export function run() {}",
    "export class Engine {}",
    "export enum Mode { A }",
    "export const { left: destructured } = { left: 1 };",
    "export interface Shape {}",
    "export type Alias = string;",
    "export declare const ambient: number;",
  ].join("\n"),
  "packages/example/src/more.ts": "export const more = 2;\n",
  "packages/example/src/renamed.ts": "export const renamed = 3;\nexport default 4;\n",
  "packages/example/src/types.ts": "export type OnlyType = string;\n",
  "packages/example/src/imported.ts": "export const imported = 5;\n",
  "packages/example/src/left.ts": "export const clash = 6;\n",
  "packages/example/src/right.ts": "export const clash = 7;\n",
  "packages/example/src/nested/index.ts": 'export * from "./deep.js";\n',
  "packages/example/src/nested/deep.ts": "export const deep = 8;\n",
};
