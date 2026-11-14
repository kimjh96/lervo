"use strict";

const { join } = require("node:path");

const { stringify } = require("./ci-test-input-intrinsics.cjs");

/**
 * A directory's listing digest (ADR-0565). The recorder computes it when a record is spooled, and
 * the shadow predictor computes it again at the head, so both use this function. It hashes the
 * JSON of the listing kind and every entry's relative name and type, so names that contain
 * newlines, a plain listing and a recursive one, and a file replaced by a link never collide.
 * A recursive listing walks directories without following links, as `readdir` does, and gives up
 * past a bound, because a listing of the repository root would walk every installed dependency.
 * `fs.readdirSync` and `createHash` are passed in, so the recorder can pass its preload captures.
 */
const maximumListingEntries = 100_000;

function direntType(dirent) {
  if (dirent.isSymbolicLink()) return "link";
  if (dirent.isFile()) return "file";
  if (dirent.isDirectory()) return "directory";
  return "other";
}

/** Appends `[relative name, type]` below `directory`; `false` once past the bound. */
function walk(readdirSync, base, directory, recursive, entries) {
  const absolute = directory === "" ? base : join(base, directory);
  for (const dirent of readdirSync(absolute, { withFileTypes: true })) {
    const name = directory === "" ? dirent.name : `${directory}/${dirent.name}`;
    entries.push([name, direntType(dirent)]);
    if (entries.length > maximumListingEntries) return false;
    if (recursive && dirent.isDirectory() && !walk(readdirSync, base, name, true, entries))
      return false;
  }
  return true;
}

/** The digest, or `null` when the listing passed its bound. Read errors propagate. */
function ciTestListingDigest({ readdirSync, createHash }, path, recursive) {
  const entries = [];
  if (!walk(readdirSync, path, "", recursive, entries)) return null;
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const text = stringify({ kind: recursive ? "recursive" : "plain", entries });
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

module.exports = { ciTestDirentType: direntType, ciTestListingDigest };
