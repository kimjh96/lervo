import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

export const VERIFICATION_BUILD_MARKER = "node_modules/.cache/lervo/verification-build.json";

/** Documentation, private Lervo state, and release intent never feed TypeScript or bundle builds. */
export function isVerificationBuildInput(path) {
  return !(
    path.endsWith(".md") ||
    path.endsWith(".tsbuildinfo") ||
    path.startsWith("docs/") ||
    path.startsWith(".lervo/") ||
    path.startsWith(".changes/")
  );
}

/** Digest exact working-tree bytes of every tracked or untracked nonignored build input. */
export function verificationBuildInputDigest(root) {
  const paths = execFileSync(
    "git",
    ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((path) => path.length > 0 && isVerificationBuildInput(path))
    .sort();
  const digest = createHash("sha256").update(`node ${process.version}\n`);
  for (const path of [...new Set(paths)]) {
    const absolute = resolve(root, path);
    let content;
    try {
      const stat = lstatSync(absolute);
      content = stat.isSymbolicLink() ? `link:${readlinkSync(absolute)}` : readFileSync(absolute);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    digest.update(`${path}\0${createHash("sha256").update(content).digest("hex")}\n`);
  }
  return `sha256:${digest.digest("hex")}`;
}

/** A recorded successful build is reusable only for identical inputs with its outputs present. */
export function verificationBuildCurrent(root, digest, requiredOutputs) {
  const marker = resolve(root, VERIFICATION_BUILD_MARKER);
  if (!existsSync(marker) || !requiredOutputs.every((path) => existsSync(resolve(root, path))))
    return false;
  try {
    return JSON.parse(readFileSync(marker, "utf8")).inputDigest === digest;
  } catch {
    return false;
  }
}

export function recordVerificationBuild(root, digest) {
  const marker = resolve(root, VERIFICATION_BUILD_MARKER);
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, `${JSON.stringify({ schemaVersion: 1, inputDigest: digest })}\n`);
}

const retainedArchives = 2;

/** Worktrees share one Git common directory, so archives survive disposable checkouts. */
function sharedArchiveDirectory(root) {
  const common = execFileSync(
    "git",
    ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  return resolve(common, "lervo-verification-builds");
}

const archivePath = (root, digest) =>
  resolve(sharedArchiveDirectory(root), `${digest.replace("sha256:", "")}.tar`);

function buildOutputDirectories(root) {
  return ["apps", "packages"].flatMap((group) =>
    existsSync(resolve(root, group))
      ? readdirSync(resolve(root, group))
          .map((name) => `${group}/${name}/dist`)
          .filter((path) => existsSync(resolve(root, path)))
      : [],
  );
}

/** Store successful build outputs under their exact input digest, keeping only recent archives. */
export function archiveVerificationBuild(root, digest) {
  const directories = buildOutputDirectories(root);
  if (!directories.length) return;
  const target = archivePath(root, digest);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  execFileSync("tar", ["-cf", temporary, "-C", root, ...directories]);
  renameSync(temporary, target);
  const archives = readdirSync(dirname(target))
    .filter((name) => name.endsWith(".tar"))
    .map((name) => resolve(dirname(target), name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  for (const stale of archives.slice(retainedArchives)) rmSync(stale, { force: true });
}

/** Restore outputs built from identical inputs in another checkout of the same repository. */
export function restoreVerificationBuild(root, digest, requiredOutputs) {
  const source = archivePath(root, digest);
  if (!existsSync(source)) return false;
  execFileSync("tar", ["-xf", source, "-C", root]);
  return requiredOutputs.every((path) => existsSync(resolve(root, path)));
}
