import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { safeOptionalText } from "./terminal-integration-files.js";
import {
  readTerminalRuntimePointer,
  type TerminalRuntimePointer,
} from "./terminal-runtime-store-paths.js";
import {
  assertHostTerminalRuntimeParents,
  assertPrivateTerminalRuntimePath,
  verifyPrivateTerminalRuntimeArtifact,
} from "./terminal-runtime-store-trust.js";

async function privateRuntimeCoordinate(store: string, directory: string): Promise<boolean> {
  await assertHostTerminalRuntimeParents(store);
  await assertPrivateTerminalRuntimePath(store, "directory");
  await assertPrivateTerminalRuntimePath(resolve(store, "current.json"), "file");
  await assertPrivateTerminalRuntimePath(resolve(store, directory), "directory");
  return true;
}

async function matchesHostManifest(
  store: string,
  pointer: TerminalRuntimePointer,
): Promise<boolean> {
  const file = await safeOptionalText(resolve(store, pointer.directory, "runtime-v2.json"));
  if (file === null) return false;
  const manifest = JSON.parse(file.content);
  return manifest.schemaVersion === 3 && manifest.contentHash === pointer.contentHash;
}

/** Read-only host health. A marker persists until a resident verifies the active artifact. */
export async function inspectHostTerminalRuntime(
  store: string,
): Promise<"current" | "unavailable"> {
  try {
    const pointer = await readTerminalRuntimePointer(store);
    return pointer !== null &&
      (await privateRuntimeCoordinate(store, pointer.directory)) &&
      (await verifyPrivateTerminalRuntimeArtifact(resolve(store, pointer.directory))) &&
      (await matchesHostManifest(store, pointer)) &&
      !(await terminalRuntimeRepairMarked(store, false))
      ? "current"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}

export type TerminalRuntimePublicationAuthority = "publish" | "repair";

/** Markers force verification even on the default, cheap startup path. */
export async function hostTerminalRuntimeNeedsMaterialization(
  store: string,
  contentHash: string,
  verification: "pointer" | "artifact" | "unavailable_marker" = "pointer",
  authority: TerminalRuntimePublicationAuthority = "publish",
): Promise<boolean> {
  try {
    await assertHostTerminalRuntimeParents(store);
    await assertPrivateTerminalRuntimePath(store, "directory");
    const pointer = await readTerminalRuntimePointer(store);
    if (pointer === null) return true;
    await assertPrivateTerminalRuntimePath(resolve(store, "current.json"), "file");
    await assertPrivateTerminalRuntimePath(resolve(store, pointer.directory), "directory");
    const marked = await terminalRuntimeRepairMarked(store);
    const publisherExists = await lstat(pointer.publisher).then(
      (stat) => stat.isFile(),
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (authority === "publish" && pointer.contentHash !== contentHash) return true;
    if (!publisherExists) return true;
    if (marked) {
      // Verify before repair; even a valid artifact must clear the durable marker.
      await inspectHostTerminalRuntime(store);
      return true;
    }
    return verification === "artifact" && (await inspectHostTerminalRuntime(store)) !== "current";
  } catch {
    return true;
  }
}

async function terminalRuntimeRepairMarked(store: string, includePending = true): Promise<boolean> {
  for (const name of [
    "unavailable.json",
    "repair.json",
    ...(includePending ? [".pending.json"] : []),
  ])
    if (
      await lstat(resolve(store, name)).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      )
    )
      return true;
  return false;
}
