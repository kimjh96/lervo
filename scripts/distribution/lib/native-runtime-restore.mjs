import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readNativeFileSyncArtifact } from "../../shared/native-file-sync-artifact.mjs";
import { readNativeCasArtifact } from "../../shared/native-cas-artifact.mjs";

/** Replace both package outputs from admitted bytes; one fixed stage bounds interrupted or failed rollback recovery. */
export async function restoreNativeRuntimePackages(repositoryRoot, artifact) {
  const outputs = [
    {
      key: "sync",
      root: resolve(repositoryRoot, "packages/filesystem-durability/dist"),
      read: readNativeFileSyncArtifact,
    },
    { key: "cas", root: resolve(repositoryRoot, "packages/cas/dist"), read: readNativeCasArtifact },
  ];
  for (const output of outputs) {
    await mkdir(output.root, { recursive: true });
    const stat = await lstat(output.root);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("native_transfer_destination_invalid");
    for (const name of [".native-copy", ".cas-native-build"]) {
      try {
        await lstat(resolve(output.root, name));
        throw new Error("native_transfer_recovery_or_copy_pending");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  const stage = resolve(outputs[1].root, ".native-runtime-transfer");
  try {
    await mkdir(stage);
  } catch (error) {
    throw new Error("native_transfer_recovery_or_copy_pending", { cause: error });
  }
  let retain = false;
  try {
    for (const output of outputs) {
      output.destination = resolve(output.root, "native");
      output.prior = resolve(stage, output.key + "-prior");
      output.prepared = resolve(stage, output.key + "-prepared");
      output.hadPrior = Boolean(await output.read(output.destination));
      await mkdir(output.prepared);
      for (const [name, bytes] of Object.entries(artifact[output.key].files))
        await writeFile(resolve(output.prepared, name), bytes, { flag: "wx", mode: 0o644 });
    }
    for (const output of outputs) {
      if (output.hadPrior) {
        await rename(output.destination, output.prior);
        output.moved = true;
      }
      await rename(output.prepared, output.destination);
      output.installed = true;
    }
  } catch (error) {
    const failures = [];
    for (const output of [...outputs].reverse()) {
      try {
        if (output.installed) await rename(output.destination, output.prepared);
        if (output.moved) await rename(output.prior, output.destination);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length) {
      retain = true;
      throw new AggregateError([error, ...failures], "native_transfer_rollback_failed", {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (!retain) await rm(stage, { recursive: true, force: true });
  }
}
