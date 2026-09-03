import { resolve } from "node:path";

import { readJson } from "./installed-cli.mjs";

const releaseVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

export async function readProductReleaseVersion(repositoryRoot) {
  const manifest = await readJson(resolve(repositoryRoot, "apps/cli/package.json"));
  if (
    manifest.name !== "@lervo/cli" ||
    manifest.private === true ||
    typeof manifest.version !== "string" ||
    !releaseVersionPattern.test(manifest.version)
  ) {
    throw new Error("The public Lervo CLI manifest does not contain a stable release version.");
  }
  return manifest.version;
}
