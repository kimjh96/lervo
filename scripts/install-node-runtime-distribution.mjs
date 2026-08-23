import { cp, lstat, mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import {
  NodeRuntimeDistributionError,
  verifyNodeDistributionArchive,
} from "./lib/node-runtime-distribution.mjs";

function parse(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  if (normalized.at(-1) !== "--write") {
    throw new NodeRuntimeDistributionError("node_distribution_write_required", "Installation requires --write as the final argument.");
  }
  const values = new Map();
  for (let index = 0; index < normalized.length - 1; index += 2) {
    const key = normalized[index];
    const value = normalized[index + 1];
    if (!["--archive", "--artifact", "--expected-sha256", "--target"].includes(key) || value === undefined || values.has(key)) {
      throw new NodeRuntimeDistributionError("node_distribution_arguments_invalid", "Usage: --archive <absolute.tar.gz> --artifact <absolute.json> --expected-sha256 <sha256:...> --target <new-absolute-directory> --write");
    }
    values.set(key, value);
  }
  if (values.size !== 4 || !isAbsolute(values.get("--archive")) || !isAbsolute(values.get("--artifact")) || !isAbsolute(values.get("--target"))) {
    throw new NodeRuntimeDistributionError("node_distribution_arguments_invalid", "Node distribution installation requires absolute paths.");
  }
  return {
    archive: values.get("--archive"),
    artifact: values.get("--artifact"),
    expectedSha256: values.get("--expected-sha256"),
    target: resolve(values.get("--target")),
  };
}

async function install(input) {
  const parent = dirname(input.target);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new NodeRuntimeDistributionError("node_distribution_target_invalid", "The installation parent must be a real directory, not a symbolic link.");
  }
  input.target = resolve(await realpath(parent), basename(input.target));
  try {
    await lstat(input.target);
    throw new NodeRuntimeDistributionError("node_distribution_target_exists", "An existing installation target will not be overwritten.");
  } catch (error) {
    if (error instanceof NodeRuntimeDistributionError) throw error;
    if (error?.code !== "ENOENT") throw error;
  }
  const verified = await verifyNodeDistributionArchive({
    archive: input.archive,
    artifact: input.artifact,
    expectedSha256: input.expectedSha256,
    stagingParent: parent,
    requireCurrentPlatform: true,
    smoke: true,
  });
  let created = false;
  try {
    await mkdir(input.target, { mode: 0o700 });
    created = true;
    await cp(verified.payloadRoot, input.target, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    return {
      target: input.target,
      entrypoint: resolve(input.target, verified.manifest.entrypoint),
      runtimeVersion: verified.manifest.runtimeVersion,
    };
  } catch (error) {
    if (created) await rm(input.target, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(verified.temporaryRoot, { recursive: true, force: true });
  }
}

try {
  const result = await install(parse(process.argv.slice(2)));
  process.stdout.write(`Installed the Lervo Node distribution.\nentrypoint: ${result.entrypoint}\nversion: ${result.runtimeVersion}\nThe service was not enabled.\n`);
} catch (error) {
  const code = error instanceof NodeRuntimeDistributionError ? error.code : "node_distribution_install_failed";
  process.stderr.write(`${code}: The Lervo Node distribution could not be installed.\n`);
  process.exitCode = 1;
}
