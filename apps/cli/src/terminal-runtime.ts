import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  loadTerminalHookNativeAssets,
  TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES,
  type TerminalRuntimeAsset,
  hostTerminalRuntimeNeedsMaterialization,
  materializeHostTerminalRuntime,
  terminalHookRuntimeStorePath,
  sha256,
} from "@lervo/repository-knowledge";
import { lstat, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { activeCliEntry, newerRuntimePublisher } from "./installed-cli-version.js";
import { isInstalledTerminalRuntimeCli } from "./terminal-runtime-installation.js";
import { STARTUP_EFFECTS_VARIABLE } from "./startup-effects.js";
import { readCliPackageVersion } from "./version-command.js";

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

/** The file's bytes when it is a regular file, not a link, within the launcher bound; else null. */
async function launcherBytes(path: string): Promise<Buffer | null> {
  try {
    const found = await lstat(path);
    if (!found.isFile() || found.size > TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

/**
 * Makes the host launcher the bundled one: when the file is missing, is no regular file, or
 * differs from this CLI's launcher, it is replaced atomically with an owner-only copy. A failure
 * only leaves hosted sessions on the CLI's terminal hook.
 */
export async function ensureHostTerminalLauncher(store: string): Promise<void> {
  const path = hostTerminalLauncherPath(store);
  const bundled = await loadTerminalHookLauncher();
  if ((await launcherBytes(path))?.equals(Buffer.from(bundled)) === true) return;
  const temporary = resolve(store, `.launcher-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bundled, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Whether a hosted session may run the host launcher at `path`: a regular file, not a link, that
 * holds exactly this CLI's launcher and, where the platform has owners, belongs to the user and
 * is writable by no one else. Anything else leaves the session on the CLI's terminal hook.
 */
export async function trustedHostTerminalLauncher(path: string): Promise<boolean> {
  try {
    const found = await lstat(path);
    if (!found.isFile()) return false;
    const uid = process.getuid?.();
    if (uid !== undefined && (found.uid !== uid || (found.mode & 0o022) !== 0)) return false;
    const bytes = await launcherBytes(path);
    return bytes?.equals(Buffer.from(await loadTerminalHookLauncher())) === true;
  } catch {
    return false;
  }
}

/** The build embeds the runtime identity so unchanged CLI startup never reads the bundle. */
export async function ensureHostTerminalRuntime(
  input: {
    authority?: "publish" | "repair";
    verification?: "pointer" | "artifact" | "unavailable_marker";
    store?: string;
    /** The active install's `dist/bin.js`; read from the host's `lervo` link when omitted. */
    activeEntry?: string | null;
  } = {},
): Promise<"current" | "materialized" | "busy"> {
  if (process.env.NODE_ENV === "test" && input.store === undefined) return "current";
  const store = input.store ?? terminalHookRuntimeStorePath();
  // A newer CLI's runtime stays; it repairs its own when it runs.
  if (
    (await newerRuntimePublisher(
      store,
      readCliPackageVersion(),
      input.activeEntry === undefined ? await activeCliEntry() : input.activeEntry,
    )) !== null
  )
    return "current";
  const contentHash = await installedRuntimeHash();
  if (
    !(await hostTerminalRuntimeNeedsMaterialization(
      store,
      contentHash,
      input.verification,
      input.authority,
    ))
  ) {
    await ensureHostTerminalLauncher(store).catch(() => undefined);
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
  if (result !== "busy") await ensureHostTerminalLauncher(store).catch(() => undefined);
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
