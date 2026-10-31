import { canonicalJson, sha256 } from "./integrity.js";
import { terminalRuntimeAssetBindings } from "./terminal-runtime-assets.js";
import {
  CONTRACT_ID,
  RUNTIME_PATH,
  TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES,
  type TerminalRuntimeAsset,
} from "./terminal-integration-contract.js";

export function validRuntimeContent(content: string): boolean {
  const bytes = Buffer.byteLength(content);
  return (
    bytes > 0 &&
    bytes <= TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES &&
    content.startsWith("#!/usr/bin/env node\n")
  );
}
export function terminalRuntimeManifest(
  content: string,
  assets: readonly TerminalRuntimeAsset[],
  schemaVersion: number = 4,
): string {
  const bindings = terminalRuntimeAssetBindings(assets);
  return `${canonicalJson({
    schemaVersion,
    kind: schemaVersion === 4 ? "lervo_terminal_hook_launcher" : "lervo_terminal_hook_runtime",
    contractId: CONTRACT_ID,
    runtimePath: RUNTIME_PATH,
    contentHash: sha256(content),
    byteCount: Buffer.byteLength(content),
    ...(schemaVersion === 3 || bindings.length ? { assets: bindings } : {}),
  })}\n`;
}
