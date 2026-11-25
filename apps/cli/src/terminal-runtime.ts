import { fileURLToPath } from "node:url";
import {
  loadTerminalHookNativeAssets,
  type TerminalRuntimeAsset,
  hostTerminalRuntimeNeedsMaterialization,
  materializeHostTerminalRuntime,
  terminalHookRuntimeStorePath,
  sha256,
} from "@lervo/repository-knowledge";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isInstalledTerminalRuntimeCli } from "./terminal-runtime-installation.js";
import { STARTUP_EFFECTS_VARIABLE } from "./startup-effects.js";

const testRuntime =
  "#!/usr/bin/env node\nprocess.stderr.write('terminal runtime fixture must not execute');\n";

export async function loadTerminalHookRuntime(): Promise<string> {
  if (process.env.NODE_ENV === "test") return testRuntime;
  return readFile(new URL("./terminal-hook.js", import.meta.url), "utf8");
}

export async function loadTerminalHookRuntimeAssets(): Promise<TerminalRuntimeAsset[]> {
  if (process.env.NODE_ENV === "test" || process.platform !== "darwin") return [];
  return loadTerminalHookNativeAssets(
    fileURLToPath(new URL("./", import.meta.url)),
    process.platform === "darwin",
  );
}

declare const __LERVO_TERMINAL_RUNTIME_HASH__: string;

async function installedRuntimeHash(): Promise<string> {
  return typeof __LERVO_TERMINAL_RUNTIME_HASH__ === "string"
    ? __LERVO_TERMINAL_RUNTIME_HASH__
    : sha256(await loadTerminalHookRuntime());
}

export async function hostTerminalHookReaderCurrent(
  store: string = terminalHookRuntimeStorePath(),
): Promise<boolean> {
  return !(await hostTerminalRuntimeNeedsMaterialization(
    store,
    await installedRuntimeHash(),
    "artifact",
    "repair",
  ));
}

export async function loadTerminalHookLauncher(): Promise<string> {
  return readFile(new URL("./terminal-hook-launcher.mjs", import.meta.url), "utf8");
}

/**
 * The host launcher beside the runtime store: the same launcher a repository commits as
 * `.lervo/generated/terminal-hooks/runtime-v2.mjs`, which verifies and runs the store's current
 * runtime. Hosted sessions run it in worktrees that commit no launcher (ADR-0632, S2a), so every
 * session takes the one path from launcher to verified runtime.
 */
export function hostTerminalLauncherPath(store: string = terminalHookRuntimeStorePath()): string {
  return resolve(store, "launcher.mjs");
}

/**
 * Writes the host launcher when it is missing, or with `refresh` after the runtime changed, as
 * an owner-only file replaced atomically. A failure only leaves hosted sessions on the CLI's
 * terminal hook.
 */
export async function ensureHostTerminalLauncher(store: string, refresh: boolean): Promise<void> {
  const path = hostTerminalLauncherPath(store);
  if (
    !refresh &&
    (await lstat(path).then(
      (stat) => stat.isFile(),
      () => false,
    ))
  )
    return;
  const temporary = resolve(store, `.launcher-${process.pid}.tmp`);
  try {
    await writeFile(temporary, await loadTerminalHookLauncher(), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** The build embeds the runtime identity so unchanged CLI startup never reads the bundle. */
export async function ensureHostTerminalRuntime(
  input: {
    authority?: "publish" | "repair";
    verification?: "pointer" | "artifact" | "unavailable_marker";
    store?: string;
  } = {},
): Promise<"current" | "materialized" | "busy"> {
  if (process.env.NODE_ENV === "test" && input.store === undefined) return "current";
  const store = input.store ?? terminalHookRuntimeStorePath();
  const contentHash = await installedRuntimeHash();
  if (
    !(await hostTerminalRuntimeNeedsMaterialization(
      store,
      contentHash,
      input.verification,
      input.authority,
    ))
  ) {
    await ensureHostTerminalLauncher(store, false).catch(() => undefined);
    return "current";
  }
  const runtimeContent = await loadTerminalHookRuntime();
  if (sha256(runtimeContent) !== contentHash)
    throw new Error("The installed terminal runtime changed.");
  const result = await materializeHostTerminalRuntime({
    store,
    runtimeContent,
    assets: await loadTerminalHookRuntimeAssets(),
    publisher: await realpath(
      process.env.LERVO_CLI_ENTRY ?? process.argv[1] ?? fileURLToPath(import.meta.url),
    ),
    authority: input.authority ?? "publish",
  });
  if (result !== "busy")
    await ensureHostTerminalLauncher(store, result === "materialized").catch(() => undefined);
  return result;
}

/**
 * ADR-0539 startup trigger. Only an installed CLI owns the host hook runtime; a source-checkout
 * build never replaces it at startup. The host resident only repairs; it never republishes.
 */
export async function ensureStartupHostTerminalRuntime(
  entry: string,
  argv: readonly string[],
): Promise<void> {
  // ADR-0571's health gate runs a candidate before deciding to keep it, and restoring links cannot
  // undo a published host runtime, so only the gate's probe skips startup effects. Every ordinary
  // invocation, `--version` included, still refreshes the host runtime after an upgrade.
  if (process.env[STARTUP_EFFECTS_VARIABLE] === "skip") return;
  if (!(await isInstalledTerminalRuntimeCli(entry))) return;
  await ensureHostTerminalRuntime({
    authority:
      argv[0] === "knowledge" && argv[1] === "worker" && argv.includes("--host")
        ? "repair"
        : "publish",
  }).catch(() => undefined);
}
