import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  hostTerminalRuntimeNeedsMaterialization,
  type TerminalRuntimePublicationAuthority,
} from "./terminal-runtime-store-health.js";
import {
  assertHostTerminalRuntimeParents,
  assertPrivateTerminalRuntimePath,
  verifyPrivateTerminalRuntimeArtifact,
} from "./terminal-runtime-store-trust.js";
import { sha256 } from "./integrity.js";
import { terminalRuntimeAssetBindings } from "./terminal-runtime-assets.js";
import { terminalRuntimeManifest } from "./terminal-runtime-manifest.js";
import {
  TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES,
  type TerminalRuntimeAsset,
} from "./terminal-integration-contract.js";
import { safeOptionalText } from "./terminal-integration-files.js";
import { acquireTerminalRuntimeStoreLock } from "./terminal-runtime-store-lock.js";
import {
  readTerminalRuntimePointer,
  type TerminalRuntimePointer,
} from "./terminal-runtime-store-paths.js";

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.platform !== "win32" && stat.uid !== process.getuid!())
  )
    throw new Error("Unsafe terminal runtime store.");
  await chmod(path, 0o700);
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const stat = await lstat(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function materializeHostTerminalRuntime(input: {
  store: string;
  runtimeContent: string;
  assets: readonly TerminalRuntimeAsset[];
  publisher?: string;
  authority?: TerminalRuntimePublicationAuthority;
  failureInjector?: (checkpoint: "staged" | "published" | "pointed") => void | Promise<void>;
}): Promise<"current" | "materialized" | "busy"> {
  const contentHash = sha256(input.runtimeContent);
  if (
    !input.runtimeContent.startsWith("#!/usr/bin/env node\n") ||
    Buffer.byteLength(input.runtimeContent) > TERMINAL_HOOK_RUNTIME_MAXIMUM_BYTES
  )
    throw new Error("Invalid host terminal runtime.");
  terminalRuntimeAssetBindings(input.assets);
  await assertHostTerminalRuntimeParents(input.store);
  await privateDirectory(input.store);
  await assertHostTerminalRuntimeParents(input.store);
  const release = await acquireTerminalRuntimeStoreLock(input.store);
  if (release === null) return "busy";
  let stage: string | null = null;
  let pointerStage: string | null = null;
  try {
    if (
      input.authority === "repair" &&
      !(await hostTerminalRuntimeNeedsMaterialization(
        input.store,
        contentHash,
        "pointer",
        "repair",
      ))
    )
      return "current";
    const publisher = await realpath(input.publisher ?? process.execPath);
    const previous = await readTerminalRuntimePointer(input.store).catch(() => null);
    await rm(resolve(input.store, ".pending.json"), { force: true });
    await writeFile(
      resolve(input.store, ".pending.json"),
      `${JSON.stringify({ schemaVersion: 1, contentHash })}\n`,
      { mode: 0o600, flag: "wx" },
    );
    let directory =
      previous?.contentHash === contentHash ? previous.directory : contentHash.slice(7, 23);
    let target = resolve(input.store, directory);
    const manifest = terminalRuntimeManifest(input.runtimeContent, input.assets, 3);
    const existingValid =
      (await directoryExists(target)) && (await verifyPrivateTerminalRuntimeArtifact(target));
    const existingManifest = existingValid
      ? (await safeOptionalText(resolve(target, "runtime-v2.json")))!.content
      : null;
    if (existingManifest !== null && JSON.parse(existingManifest).contentHash !== contentHash)
      throw new Error("The host terminal runtime hash prefix collides with an existing artifact.");
    const valid = existingManifest === manifest;
    if (!valid) {
      stage = await mkdtemp(resolve(input.store, ".stage-"));
      await chmod(stage, 0o700);
      for (const [path, content] of [
        ["runtime-v2.mjs", input.runtimeContent],
        ["runtime-v2.json", manifest],
        ...input.assets.map((asset) => [asset.path, asset.content] as const),
      ] as const) {
        await privateDirectory(dirname(resolve(stage, path)));
        await writeFile(resolve(stage, path), content, { mode: 0o600 });
      }
      await input.failureInjector?.("staged");
      // Never remove a directory that a reader's pointer can still name.
      if (
        await lstat(target).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return false;
            throw error;
          },
        )
      ) {
        directory = `${contentHash.slice(7, 23)}-repair-${randomBytes(8).toString("hex")}`;
        target = resolve(input.store, directory);
      }
      await rename(stage, target);
      stage = null;
      await input.failureInjector?.("published");
    }
    const pointerTrusted = await assertPrivateTerminalRuntimePath(
      resolve(input.store, "current.json"),
      "file",
    ).then(
      () => true,
      () => false,
    );
    if (previous?.directory !== directory || previous?.publisher !== publisher || !pointerTrusted) {
      const pointer: TerminalRuntimePointer = {
        schemaVersion: 1,
        directory,
        contentHash,
        publisher,
        predecessor:
          previous === null
            ? null
            : previous.directory === directory
              ? previous.predecessor
              : { directory: previous.directory, contentHash: previous.contentHash },
      };
      pointerStage = resolve(input.store, `.current-${process.pid}.tmp`);
      await writeFile(pointerStage, `${JSON.stringify(pointer)}\n`, { mode: 0o600, flag: "wx" });
      await rename(pointerStage, resolve(input.store, "current.json"));
      pointerStage = null;
    }
    await input.failureInjector?.("pointed");
    const current = (await readTerminalRuntimePointer(input.store))!;
    for (const name of await readdir(input.store))
      if (
        (/^[a-f0-9]{16}(?:-repair-[a-f0-9]{16})?$/u.test(name) &&
          name !== current.directory &&
          name !== current.predecessor?.directory) ||
        name.startsWith(".stage-") ||
        /^\.(?:current|unavailable|repair)-[0-9]+\.tmp$/u.test(name)
      )
        await rm(resolve(input.store, name), { recursive: true, force: true });
    await rm(resolve(input.store, "repair.json"), { force: true });
    await rm(resolve(input.store, "unavailable.json"), { force: true });
    await rm(resolve(input.store, ".pending.json"), { force: true });
    return previous?.contentHash === contentHash && valid ? "current" : "materialized";
  } finally {
    if (stage !== null) await rm(stage, { recursive: true, force: true });
    if (pointerStage !== null) await rm(pointerStage, { force: true });
    await release();
  }
}
