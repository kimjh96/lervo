import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const nativeRoot = fileURLToPath(new URL("../native/", import.meta.url));
export const run = promisify(execFile);
export type Operation = [string] | [string, string, string];
export type Result = { created: boolean } & (
  | { status: "complete"; bytes: Buffer }
  | { status: "large" }
  | {
      status: "failed";
      code: "unsafe_path" | "system_error";
      errno: number;
      syscall: string;
      pathIndex: number;
    }
);
export interface NativeCas {
  batch(operations: Operation[]): Promise<Result[]>;
}

export async function compileNative(
  root: string,
  name: string,
  wrappers: { binding?: string; kernel?: string } = {},
): Promise<{ binary: string; native: NativeCas }> {
  const sources: string[] = [];
  for (const [key, file] of [
    ["binding", "binding.c"],
    ["kernel", "cas-io.c"],
  ] as const) {
    const body = wrappers[key];
    const source =
      body === undefined ? resolve(nativeRoot, file) : resolve(root, `${name}-${file}`);
    if (body !== undefined) await writeFile(source, body);
    sources.push(source);
  }
  const binary = resolve(root, `${name}.node`);
  const headers = resolve(dirname(await realpath(process.execPath)), "../include/node");
  await run("xcrun", [
    "clang",
    "-std=c11",
    "-O2",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-DNAPI_VERSION=8",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-I",
    headers,
    "-I",
    nativeRoot,
    ...sources,
    "-o",
    binary,
  ]);
  return { binary, native: createRequire(import.meta.url)(binary) as NativeCas };
}
