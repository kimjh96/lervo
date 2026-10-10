import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./integrity.js";
import { safeOptionalBytes, isObject } from "./terminal-integration-files.js";
import type {
  TerminalRuntimeAsset,
  TerminalRuntimeAssetBinding,
} from "./terminal-integration-contract.js";
import { RepositoryKnowledgeError } from "./types.js";

const syncPaths = ["native/file-sync-darwin.node", "native/file-sync.json"] as const;
const completePaths = ["native/cas-io-darwin.node", "native/cas-io.json", ...syncPaths] as const;
function invalid(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_source_unsafe",
    "The terminal native asset set is invalid.",
  );
}

function validatePair(binary: Uint8Array, bytes: Uint8Array): void {
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
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
    manifest.contentHash !== sha256(binary)
  )
    invalid();
}

/** Installation binds qualified release bytes without loading native code. */
export function terminalRuntimeAssetBindings(
  assets: readonly TerminalRuntimeAsset[],
): TerminalRuntimeAssetBinding[] {
  if (!assets.length) return [];
  const paths = assets.length === 4 ? completePaths : syncPaths;
  if (
    assets.length !== paths.length ||
    assets.some(
      (asset, index) =>
        asset.path !== paths[index] ||
        !(asset.content instanceof Uint8Array) ||
        !asset.content.byteLength ||
        asset.content.byteLength > (asset.path.endsWith(".node") ? 1048576 : 4096),
    )
  )
    invalid();
  for (let index = 0; index < assets.length; index += 2)
    validatePair(assets[index]!.content, assets[index + 1]!.content);
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
  const names = (await readdir(native)).sort();
  const paths = names.some((name) => name.startsWith("cas-io")) ? completePaths : syncPaths;
  if (names.join(",") !== paths.map((path) => path.slice("native/".length)).join(",")) invalid();
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
