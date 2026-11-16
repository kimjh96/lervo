import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { RELEASE_METADATA_FILES } from "./ci-release-metadata.mjs";

/**
 * Release preparation writes these, the release metadata files, and the CLI version. A candidate
 * that differs from verified source only there reuses that source's test results; its build,
 * metadata and distribution still run.
 */
const RELEASE_METADATA_DIRECTORY = ".changes/";
const VERSIONED_MANIFEST = "apps/cli/package.json";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * Content digests that key verification reuse. `tree` is the exact Git tree. `tests` drops the
 * release metadata files and the CLI package version, which release preparation changes without
 * changing source.
 */
export function computeCiContentDigests({ repositoryRoot, revision }) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  const tree = git(["rev-parse", `${revision}^{tree}`]).trim();
  if (!/^[a-f0-9]{40}$/u.test(tree)) throw new Error("ci_content_tree_invalid");
  const entries = [];
  for (const entry of git(["ls-tree", "-r", "-z", "--full-tree", revision]).split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    const path = entry.slice(tab + 1);
    if (path.startsWith(RELEASE_METADATA_DIRECTORY) || RELEASE_METADATA_FILES.includes(path))
      continue;
    if (path === VERSIONED_MANIFEST) {
      const { version: _version, ...manifest } = JSON.parse(git(["show", `${revision}:${path}`]));
      // Keep the file mode; the blob ID changes with the version and must not enter the digest.
      entries.push(`${entry.split(" ")[0]}\t${path}\t${sha256(JSON.stringify(manifest))}`);
      continue;
    }
    entries.push(entry);
  }
  return { tree, tests: sha256(entries.join("\n")) };
}
