import { fileURLToPath } from "node:url";
import {
  loadTerminalHookNativeAssets,
  type TerminalRuntimeAsset,
} from "@lervo/repository-knowledge";
import { readFile } from "node:fs/promises";

const testRuntime =
  "#!/usr/bin/env node\nprocess.stderr.write('terminal runtime fixture must not execute');\n";

export async function loadTerminalHookRuntime(): Promise<string> {
  if (process.env.NODE_ENV === "test") return testRuntime;
  return readFile(new URL("./terminal-hook.js", import.meta.url), "utf8");
}

export async function loadTerminalHookRuntimeAssets(): Promise<TerminalRuntimeAsset[]> {
  if (process.env.NODE_ENV === "test") return [];
  return loadTerminalHookNativeAssets(
    fileURLToPath(new URL("./", import.meta.url)),
    process.platform === "darwin",
  );
}
