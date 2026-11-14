import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { release } from "node:os";
import { relative, resolve } from "node:path";

import { parse } from "yaml";

/**
 * The toolchain digest G (ADR-0565): everything outside a test file's recorded closure that can
 * still change its result. A future reuse key is the recorded closure plus G, so any change here
 * invalidates every file at once. The CLI package version is left out, as in the test digest of
 * ADR-0522, because release preparation changes it without changing behavior under test.
 */
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const VERSIONED_MANIFEST = "apps/cli/package.json";
const NATIVE_ARTIFACT_DIRECTORIES = [
  "packages/filesystem-durability/dist/native",
  "packages/cas/dist/native",
];
const workspaceManifest =
  /^(?:package\.json|pnpm-workspace\.yaml|(?:apps|packages)\/[^/]+\/package\.json)$/u;
const testConfiguration = /(?:^|\/)(?:tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s)$/u;
const planner = /^scripts\/quality\/(?:ci-vitest\.config\.mjs|lib\/ci-test-[a-z-]+\.[cm]js)$/u;

/** Sorts object keys recursively so a reformatted workflow keeps its digest. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

async function digestFiles(repositoryRoot, paths, transform = (path, bytes) => bytes) {
  const entries = [];
  for (const path of [...paths].sort()) {
    const bytes = await readFile(resolve(repositoryRoot, path));
    entries.push(`${path}\t${sha256(transform(path, bytes))}`);
  }
  return sha256(entries.join("\n"));
}

async function filesBelow(root, directory) {
  let entries;
  try {
    entries = await readdir(resolve(root, directory), { withFileTypes: true, recursive: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, resolve(entry.parentPath, entry.name)).split("\\").join("/"));
}

/** Versions come from the running Node, the pnpm user agent and the Git on `PATH`. */
function runtimeVersions(environment) {
  const pnpm = /\bpnpm\/(\S+)/u.exec(environment.npm_config_user_agent ?? "")?.[1] ?? "unknown";
  let git = "unavailable";
  try {
    git = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    // An absent Git is itself part of the toolchain.
  }
  return `node ${process.version}; pnpm ${pnpm}; ${git}`;
}

/**
 * `tracked`: Git-tracked repository paths. `setupFiles`: repository-relative Vitest setup and
 * global setup files. Returns `{ digest, components }`; components hold digests and versions only.
 */
export async function computeCiTestToolchainDigest({
  repositoryRoot,
  tracked,
  setupFiles,
  environment = process.env,
}) {
  const trackedPaths = [...tracked];
  const workflow = parse(
    await readFile(resolve(repositoryRoot, ".github/workflows/code-quality.yml"), "utf8"),
  );
  const nativeArtifacts = [];
  for (const directory of NATIVE_ARTIFACT_DIRECTORIES)
    nativeArtifacts.push(...(await filesBelow(repositoryRoot, directory)));
  const components = {
    lockfile: await digestFiles(repositoryRoot, ["pnpm-lock.yaml"]),
    workspaceManifests: await digestFiles(
      repositoryRoot,
      trackedPaths.filter((path) => workspaceManifest.test(path)),
      (path, bytes) => {
        if (path !== VERSIONED_MANIFEST) return bytes;
        const { version: _version, ...manifest } = JSON.parse(bytes.toString("utf8"));
        return JSON.stringify(manifest);
      },
    ),
    testConfiguration: await digestFiles(
      repositoryRoot,
      trackedPaths.filter((path) => testConfiguration.test(path)),
    ),
    setupFiles: await digestFiles(repositoryRoot, setupFiles),
    testJob: sha256(JSON.stringify(canonical(workflow?.jobs?.test ?? null))),
    recorderAndPlanner: await digestFiles(
      repositoryRoot,
      trackedPaths.filter((path) => planner.test(path)),
    ),
    nativeArtifacts:
      nativeArtifacts.length === 0 ? "absent" : await digestFiles(repositoryRoot, nativeArtifacts),
    runtime: runtimeVersions(environment),
    platform: `${environment.ImageOS ?? process.platform} ${environment.ImageVersion ?? release()} ${process.arch}`,
  };
  return { digest: sha256(JSON.stringify(canonical(components))), components };
}
