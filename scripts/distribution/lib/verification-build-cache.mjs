import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
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
