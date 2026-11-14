"use strict";

const { isAbsolute, resolve, sep } = require("node:path");
const { fileURLToPath } = require("node:url");

const systemRoots = [
  "/bin",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/proc",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/Library",
  "/System",
  "/private/etc",
];

const withSeparator = (root) => (root.endsWith(sep) ? root : `${root}${sep}`);
const unique = (roots) => [...new Set(roots.filter(Boolean).map((root) => resolve(root)))];
const within = (path, roots) =>
  roots.find((root) => path === root || path.startsWith(withSeparator(root)));

/** Turns a path string or `file:` URL string into an absolute path, or `null`. */
function absoluteInputPath(path, cwd) {
  if (typeof path !== "string" || path === "") return null;
  if (path.startsWith("file:")) {
    try {
      return fileURLToPath(path);
    } catch {
      return null;
    }
  }
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/**
 * Pnpm stores each package below `node_modules/.pnpm/<id>/node_modules/<name>`. The store ID names
 * the exact locked package, so a dependency read is recorded once per package instead of per file.
 */
function dependencyKey(relativePath) {
  const parts = relativePath.split("/");
  const store = parts.indexOf(".pnpm");
  if (store >= 0 && parts[store + 1]) return `pnpm:${parts[store + 1]}`;
  const last = parts.lastIndexOf("node_modules");
  const name = parts[last + 1]?.startsWith("@")
    ? `${parts[last + 1]}/${parts[last + 2] ?? ""}`
    : parts[last + 1];
  return name ? `package:${name}` : null;
}

/**
 * Classifies absolute paths against the repository, temporary, toolchain and home roots. Paths
 * are compared as strings; the caller passes both the configured and the real root spellings.
 */
function createCiTestPathClassifier({
  repositoryRoots,
  temporaryRoots,
  toolchainRoots,
  homeDirectory,
}) {
  const repositories = unique(repositoryRoots).sort((left, right) => right.length - left.length);
  const temporary = unique(temporaryRoots);
  const toolchain = unique(toolchainRoots);
  const home = homeDirectory ? resolve(homeDirectory) : null;
  return function classify(path) {
    const repository = within(path, repositories);
    if (repository) {
      const relative = path
        .slice(repository.length + 1)
        .split(sep)
        .join("/");
      if (relative === "" || relative === ".") return { kind: "repository", path: "." };
      if (relative === ".git" || relative.startsWith(".git/"))
        return { kind: "git", path: relative };
      if (relative.split("/").includes("node_modules")) {
        const key = dependencyKey(relative);
        // A workspace link such as apps/cli/node_modules/@lervo/core points back into the tree.
        if (key?.startsWith("package:@lervo/")) return { kind: "repository", path: relative };
        return key ? { kind: "dependency", path: key } : { kind: "repository", path: relative };
      }
      return { kind: "repository", path: relative };
    }
    if (within(path, temporary)) return { kind: "temporary", path: null };
    if (within(path, toolchain)) return { kind: "toolchain", path: null };
    if (within(path, systemRoots)) return { kind: "system", path: null };
    if (home && within(path, [home]))
      return { kind: "host", path: `~${path.slice(home.length).split(sep).join("/")}` };
    return { kind: "host", path: path.split(sep).join("/") };
  };
}

module.exports = { absoluteInputPath, createCiTestPathClassifier };
