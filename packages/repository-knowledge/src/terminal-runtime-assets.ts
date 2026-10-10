import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./integrity.js";
import { safeOptionalBytes, isObject } from "./terminal-integration-files.js";
import type {
  TerminalRuntimeAsset,
  TerminalRuntimeAssetBinding,
} from "./terminal-integration-contract.js";
import { RepositoryKnowledgeError } from "./types.js";

const paths = ["native/file-sync-darwin.node", "native/file-sync.json"] as const;
function invalid(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_source_unsafe",
    "The terminal native asset pair is invalid.",
  );
}

/** Installation binds bytes already qualified by the release artifact owner; it never loads code. */
export function terminalRuntimeAssetBindings(
  assets: readonly TerminalRuntimeAsset[],
): TerminalRuntimeAssetBinding[] {
  if (assets.length === 0) return [];
  if (
    assets.length !== 2 ||
    assets.some(
      (asset, i) =>
        asset.path !== paths[i] ||
        !(asset.content instanceof Uint8Array) ||
        asset.content.byteLength === 0 ||
        asset.content.byteLength > (i === 0 ? 1048576 : 4096),
    )
  )
    invalid();
  let manifest: unknown;
  try {
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(assets[1]!.content),
    );
  } catch {
    invalid();
  }
  if (
    !isObject(manifest) ||
    Object.keys(manifest).sort().join(",") !==
      "apiVersion,architectures,contentHash,napiVersion,platform,schemaVersion,sourceHash" ||
    manifest.schemaVersion !== 1 ||
    manifest.apiVersion !== 1 ||
    manifest.napiVersion !== 8 ||
    manifest.platform !== "darwin" ||
    JSON.stringify(manifest.architectures) !== '["arm64","x64"]' ||
    typeof manifest.sourceHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(manifest.sourceHash) ||
    manifest.contentHash !== sha256(assets[0]!.content)
  )
    invalid();
  return assets.map(({ path, content }) => ({
    path,
    contentHash: sha256(content),
    byteCount: content.byteLength,
  }));
}

export async function loadTerminalHookNativeAssets(
  directory: string,
  required = true,
): Promise<TerminalRuntimeAsset[]> {
  const native = resolve(directory, "native");
  try {
    const stat = await lstat(native);
    if (!stat.isDirectory() || stat.isSymbolicLink()) invalid();
  } catch (error) {
    if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if ((await readdir(native)).sort().join(",") !== "file-sync-darwin.node,file-sync.json")
    invalid();
  const assets: TerminalRuntimeAsset[] = [];
  for (const path of paths) {
    const content = await safeOptionalBytes(
      resolve(directory, path),
      path.endsWith(".node") ? 1048576 : 4096,
    );
    if (content === null) invalid();
    assets.push({ path, content });
  }
  terminalRuntimeAssetBindings(assets);
  return assets;
}
