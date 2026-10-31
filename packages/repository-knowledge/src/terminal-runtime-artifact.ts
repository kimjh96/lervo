import { resolve } from "node:path";
import { sha256 } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";
import { terminalRuntimeAssetBindings } from "./terminal-runtime-assets.js";
import { terminalRuntimeManifest, validRuntimeContent } from "./terminal-runtime-manifest.js";
import {
  readTerminalRuntimeArtifact,
  validTerminalRuntimeArtifact,
} from "./terminal-runtime-integrity.js";
import {
  RUNTIME_PATH,
  RUNTIME_MANIFEST_PATH,
  TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES,
  type TerminalIntegrationRuntimeTarget,
  type TerminalRuntimeAsset,
  type TerminalRuntimeOperation,
} from "./terminal-integration-contract.js";

export async function inspectTerminalRuntimeArtifact(
  root: string,
): Promise<TerminalIntegrationRuntimeTarget> {
  const existing = await readTerminalRuntimeArtifact(resolve(root, RUNTIME_PATH));
  const valid = validTerminalRuntimeArtifact(existing);
  return {
    path: RUNTIME_PATH,
    manifestPath: RUNTIME_MANIFEST_PATH,
    action: valid
      ? JSON.parse(existing.manifestFile!.content).schemaVersion === 4
        ? "unchanged"
        : "update"
      : existing.artifact === null
        ? "create"
        : "blocked",
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
  if (
    !validRuntimeContent(desiredContent) ||
    Buffer.byteLength(desiredContent) > TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES ||
    assets.length
  )
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The terminal hook runtime artifact is invalid.",
    );
  const existing = await readTerminalRuntimeArtifact(resolve(root, RUNTIME_PATH));
  const desiredHash = sha256(desiredContent),
    desiredManifest = terminalRuntimeManifest(desiredContent, []);
  const operations: TerminalRuntimeOperation[] = existing.assets.map((asset) => ({
    path: `.lervo/generated/terminal-hooks/${asset.path}`,
    action: "delete",
    expectedCurrentHash: sha256(asset.content),
  }));
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
      manifestBeforeHash: existing.manifestFile?.contentHash ?? null,
      ...(existing.assets.length ? { assets: terminalRuntimeAssetBindings(existing.assets) } : {}),
    },
    operations,
  };
}
