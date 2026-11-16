import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

/**
 * Decides whether a local check must hold the committed CLI release manifest and SBOM to this
 * build (ADR-0572). `exact` applies while the working tree's CLI version has no `v<version>` tag,
 * or when the version or tag cannot be read. `released` means that version already shipped: the
 * committed files may describe an older build until the next release preparation, and CI generates
 * and reports them instead.
 */
export async function cliReleaseMetadataScope(repositoryRoot) {
  let version;
  try {
    version = JSON.parse(
      await readFile(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"),
    ).version;
  } catch {
    return { scope: "exact", version: null };
  }
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version))
    return { scope: "exact", version: null };
  try {
    await execFile("git", ["rev-parse", "--verify", "--quiet", `refs/tags/v${version}^{commit}`], {
      cwd: repositoryRoot,
    });
  } catch {
    return { scope: "exact", version };
  }
  return { scope: "released", version };
}
