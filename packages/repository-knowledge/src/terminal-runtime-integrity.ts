import { dirname, resolve } from "node:path";
import { canonicalJson } from "./integrity.js";
import { safeOptionalText, isObject } from "./terminal-integration-files.js";
import { loadTerminalHookNativeAssets } from "./terminal-runtime-assets.js";
import {
  TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES,
  TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES,
} from "./terminal-integration-contract.js";
import { terminalRuntimeManifest, validRuntimeContent } from "./terminal-runtime-manifest.js";

export async function readTerminalRuntimeArtifact(runtimePath: string) {
  const directory = dirname(runtimePath);
  const [artifact, manifestFile, assets] = await Promise.all([
    safeOptionalText(runtimePath, TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES),
    safeOptionalText(resolve(directory, "runtime-v2.json")),
    loadTerminalHookNativeAssets(directory, false),
  ]);
  return { artifact, manifestFile, assets };
}
export function validTerminalRuntimeArtifact(
  existing: Awaited<ReturnType<typeof readTerminalRuntimeArtifact>>,
): boolean {
  if (
    !existing.artifact ||
    !existing.manifestFile ||
    !validRuntimeContent(existing.artifact.content)
  )
    return false;
  try {
    const manifest: unknown = JSON.parse(existing.manifestFile.content);
    return (
      isObject(manifest) &&
      ((manifest.schemaVersion === 1 && existing.assets.length === 0) ||
        (manifest.schemaVersion === 2 && existing.assets.length === 2) ||
        (manifest.schemaVersion === 3 && [0, 4].includes(existing.assets.length)) ||
        (manifest.schemaVersion === 4 && existing.assets.length === 0)) &&
      (manifest.schemaVersion !== 4 ||
        (existing.assets.length === 0 &&
          Buffer.byteLength(existing.artifact.content) <= TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES)) &&
      manifest.contentHash === existing.artifact.contentHash &&
      canonicalJson(manifest) ===
        terminalRuntimeManifest(
          existing.artifact.content,
          existing.assets,
          manifest.schemaVersion as number,
        ).trim()
    );
  } catch {
    return false;
  }
}

/** Verify generated code and every declared native byte before processing hook input. */
export async function verifyTerminalHookRuntimeArtifact(runtimePath: string): Promise<boolean> {
  try {
    return validTerminalRuntimeArtifact(await readTerminalRuntimeArtifact(runtimePath));
  } catch {
    return false;
  }
}
