import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { nativeCasSourceHash } from "../../shared/native-cas-artifact.mjs";
import { nativeFileSyncSourceHash } from "../../shared/native-file-sync-artifact.mjs";
import { darwinToolchainPin } from "./darwin-toolchain.mjs";

/**
 * Everything that decides the darwin native bytes (ADR-0590). The two source hashes cover the C
 * files that clang compiles, the build scripts with their clang arguments, and the shared
 * contracts that write the manifests. The tree digest adds every file in the native directories,
 * so a new header or source that the hash lists miss still changes the key. The pin names the
 * Xcode, clang, and SDK that the build job checks before compiling, and Node's version decides
 * the `node_api.h` headers that clang reads from the running Node.
 */
const NATIVE_SOURCE_DIRECTORIES = ["packages/cas/native", "packages/filesystem-durability/native"];
const INPUTS_SCHEMA_VERSION = 1;
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function nativeSourceTreeDigest(repositoryRoot) {
  const entries = [];
  const pending = [...NATIVE_SOURCE_DIRECTORIES];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await readdir(resolve(repositoryRoot, directory), {
      withFileTypes: true,
    })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile())
        entries.push([path, digest(await readFile(resolve(repositoryRoot, path)))]);
      else throw new Error("native_reuse_source_invalid");
    }
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return digest(JSON.stringify(entries));
}

/** The inputs of one native build; `node` is the running process unless a test supplies one. */
export async function nativeRuntimeReuseInputs({ repositoryRoot, node = process }) {
  return {
    schemaVersion: INPUTS_SCHEMA_VERSION,
    syncSourceHash: await nativeFileSyncSourceHash(repositoryRoot),
    casSourceHash: await nativeCasSourceHash(repositoryRoot),
    nativeSourceTree: await nativeSourceTreeDigest(repositoryRoot),
    toolchain: { ...darwinToolchainPin },
    node: {
      version: node.version,
      napi: node.versions.napi,
      modules: node.versions.modules,
    },
  };
}

export const nativeRuntimeReuseKey = (inputs) =>
  createHash("sha256").update(JSON.stringify(inputs)).digest("hex");

export const nativeRuntimeReuseArtifactName = (key) => `lervo-native-runtime-${key}`;
