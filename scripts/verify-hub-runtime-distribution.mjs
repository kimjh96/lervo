import { rm } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  HubRuntimeDistributionError,
  verifyHubDistributionArchive,
} from "./lib/hub-runtime-distribution.mjs";

function parse(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  const values = new Map();
  for (let index = 0; index < normalized.length; index += 2) {
    const key = normalized[index];
    const value = normalized[index + 1];
    if (
      !["--archive", "--artifact", "--expected-sha256"].includes(key) ||
      value === undefined ||
      values.has(key)
    ) {
      throw new HubRuntimeDistributionError(
        "hub_distribution_arguments_invalid",
        "Usage: --archive <absolute.tar.gz> --artifact <absolute.json> --expected-sha256 <sha256:...>",
      );
    }
    values.set(key, value);
  }
  if (
    values.size !== 3 ||
    !isAbsolute(values.get("--archive")) ||
    !isAbsolute(values.get("--artifact"))
  ) {
    throw new HubRuntimeDistributionError(
      "hub_distribution_arguments_invalid",
      "Hub distribution verification requires absolute paths.",
    );
  }
  return {
    archive: values.get("--archive"),
    artifact: values.get("--artifact"),
    expectedSha256: values.get("--expected-sha256"),
  };
}

try {
  const verified = await verifyHubDistributionArchive({
    ...parse(process.argv.slice(2)),
    requireCurrentPlatform: true,
    smoke: true,
  });
  process.stdout.write(
    `Lervo Hub distribution verification passed (${verified.manifest.runtimeVersion}, ${verified.manifest.platform.os}-${verified.manifest.platform.arch}-${verified.manifest.platform.libc}, ${verified.manifest.files.length} file entries)\n`,
  );
  await rm(verified.temporaryRoot, { recursive: true, force: true });
} catch (error) {
  const code =
    error instanceof HubRuntimeDistributionError ? error.code : "hub_distribution_verify_failed";
  process.stderr.write(`${code}: The Lervo Hub distribution could not be verified.\n`);
  process.exitCode = 1;
}
