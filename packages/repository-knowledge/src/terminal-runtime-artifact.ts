import { dirname, resolve } from "node:path";
import { canonicalJson, sha256 } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";
import { safeOptionalText, isObject } from "./terminal-integration-files.js";
import {
  loadTerminalHookNativeAssets,
  terminalRuntimeAssetBindings,
} from "./terminal-runtime-assets.js";
import {
  CONTRACT_ID,
  RUNTIME_PATH,
  RUNTIME_MANIFEST_PATH,
  TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES,
  type TerminalIntegrationRuntimeTarget,
  type TerminalRuntimeAsset,
  type TerminalRuntimeOperation,
} from "./terminal-integration-contract.js";

function validRuntimeContent(content: string): boolean {
  const bytes = Buffer.byteLength(content);
  return (
    bytes > 0 &&
    bytes <= TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES &&
    content.startsWith("#!/usr/bin/env node\n")
  );
}
function runtimeManifest(content: string, assets: readonly TerminalRuntimeAsset[]): string {
  const bindings = terminalRuntimeAssetBindings(assets);
  return `${canonicalJson({
    schemaVersion: bindings.length === 4 ? 3 : bindings.length ? 2 : 1,
    kind: "lervo_terminal_hook_runtime",
    contractId: CONTRACT_ID,
    runtimePath: RUNTIME_PATH,
    contentHash: sha256(content),
    byteCount: Buffer.byteLength(content),
    ...(bindings.length ? { assets: bindings } : {}),
  })}\n`;
}
async function existingRuntime(runtimePath: string) {
  const directory = dirname(runtimePath);
  const [artifact, manifestFile, assets] = await Promise.all([
    safeOptionalText(runtimePath, TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES),
    safeOptionalText(resolve(directory, "runtime-v2.json")),
    loadTerminalHookNativeAssets(directory, false),
  ]);
  return { artifact, manifestFile, assets };
}
function validExisting(existing: Awaited<ReturnType<typeof existingRuntime>>): boolean {
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
      manifest.contentHash === existing.artifact.contentHash &&
      canonicalJson(manifest) === runtimeManifest(existing.artifact.content, existing.assets).trim()
    );
  } catch {
    return false;
  }
}

/** Verify generated code and every declared native byte before processing hook input. */
export async function verifyTerminalHookRuntimeArtifact(runtimePath: string): Promise<boolean> {
  try {
    return validExisting(await existingRuntime(runtimePath));
  } catch {
    return false;
  }
}

export async function inspectTerminalRuntimeArtifact(
  root: string,
): Promise<TerminalIntegrationRuntimeTarget> {
  const existing = await existingRuntime(resolve(root, RUNTIME_PATH));
  const valid = validExisting(existing);
  return {
    path: RUNTIME_PATH,
    manifestPath: RUNTIME_MANIFEST_PATH,
    action: valid ? "unchanged" : existing.artifact === null ? "create" : "blocked",
    beforeHash: existing.artifact?.contentHash ?? null,
    afterHash: existing.artifact?.contentHash ?? sha256(""),
    byteCount: existing.artifact === null ? 0 : Buffer.byteLength(existing.artifact.content),
    ...(existing.assets.length
      ? {
          assets: terminalRuntimeAssetBindings(existing.assets),
          manifestBeforeHash: existing.manifestFile?.contentHash ?? null,
        }
      : {}),
  };
}

export async function runtimeTarget(
  root: string,
  desiredContent: string,
  desiredAssets: readonly TerminalRuntimeAsset[] = [],
): Promise<{ target: TerminalIntegrationRuntimeTarget; operations: TerminalRuntimeOperation[] }> {
  const assets = desiredAssets.map(({ path, content }) => ({
    path,
    content: Uint8Array.from(content),
  }));
  if (!validRuntimeContent(desiredContent))
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The terminal hook runtime artifact is invalid.",
    );
  const bindings = terminalRuntimeAssetBindings(assets);
  const existing = await existingRuntime(resolve(root, RUNTIME_PATH));
  if (existing.assets.some((previous) => !assets.some((asset) => asset.path === previous.path)))
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "A legacy runtime cannot silently retain undeclared native assets.",
    );
  const desiredHash = sha256(desiredContent),
    desiredManifest = runtimeManifest(desiredContent, assets);
  const operations: TerminalRuntimeOperation[] = [];
  for (const asset of assets) {
    const previous = existing.assets.find((item) => item.path === asset.path);
    const beforeHash = previous ? sha256(previous.content) : null,
      desired = sha256(asset.content);
    if (beforeHash !== desired)
      operations.push({
        path: `.lervo/generated/terminal-hooks/${asset.path}`,
        action: beforeHash === null ? "create" : "update",
        ownership: "lervo_generated",
        mediaType: "application/octet-stream",
        content: Uint8Array.from(asset.content),
        ...(beforeHash === null ? {} : { expectedCurrentHash: beforeHash }),
        desiredHash: desired,
      });
  }
  if (existing.artifact?.contentHash !== desiredHash)
    operations.push({
      path: RUNTIME_PATH,
      action: existing.artifact === null ? "create" : "update",
      ownership: "lervo_generated",
      mediaType: "text/javascript",
      content: desiredContent,
      ...(existing.artifact === null ? {} : { expectedCurrentHash: existing.artifact.contentHash }),
      desiredHash,
    });
  if (existing.manifestFile?.contentHash !== sha256(desiredManifest))
    operations.push({
      path: RUNTIME_MANIFEST_PATH,
      action: existing.manifestFile === null ? "create" : "update",
      ownership: "lervo_generated",
      mediaType: "application/json",
      content: desiredManifest,
      ...(existing.manifestFile === null
        ? {}
        : { expectedCurrentHash: existing.manifestFile.contentHash }),
      desiredHash: sha256(desiredManifest),
    });
  return {
    target: {
      path: RUNTIME_PATH,
      manifestPath: RUNTIME_MANIFEST_PATH,
      action:
        operations.length === 0 ? "unchanged" : existing.artifact === null ? "create" : "update",
      beforeHash: existing.artifact?.contentHash ?? null,
      afterHash: desiredHash,
      byteCount: Buffer.byteLength(desiredContent),
      ...(bindings.length
        ? {
            assets: bindings.map((binding) => ({
              ...binding,
              beforeHash: existing.assets.find((item) => item.path === binding.path)
                ? sha256(existing.assets.find((item) => item.path === binding.path)!.content)
                : null,
            })),
            manifestBeforeHash: existing.manifestFile?.contentHash ?? null,
          }
        : {}),
    },
    operations,
  };
}
