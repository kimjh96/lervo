import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const { ciTestListingText } = createRequire(import.meta.url)("./ci-test-input-listing.cjs");

/**
 * Digests recorded test inputs in a reconstructed CI tree (ADR-0565, Stage 2): the checkout, its
 * frozen dependency install and the restored build, before any test runs. The shadow predictor
 * compares these digests between the run that recorded a closure and the current head. Every
 * value is a closed string, so two values are the same input exactly when the strings are equal:
 *
 * - `file:<x|->:<sha256>`: a regular file's bytes and whether its owner may execute it.
 * - `link:<target>><digest>`: a symbolic link's target text and the digest of what it resolves to.
 * - `directory`, `absent` or `other` (a socket, FIFO or device).
 * - `unreadable`: inspection failed or the input exceeded a bound. It never matches anything.
 */
const maximumFileBytes = 512 * 1024 * 1024;
const maximumTreeEntries = 50_000;
export const CI_TEST_INPUT_UNREADABLE = "unreadable";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const missing = (error) => error?.code === "ENOENT" || error?.code === "ENOTDIR";

function followedDigest(absolute) {
  let stats;
  try {
    stats = statSync(absolute);
  } catch (error) {
    return missing(error) ? "absent" : CI_TEST_INPUT_UNREADABLE;
  }
  if (stats.isDirectory()) return "directory";
  if (!stats.isFile()) return "other";
  if (stats.size > maximumFileBytes) return CI_TEST_INPUT_UNREADABLE;
  try {
    return `file:${stats.mode & 0o100 ? "x" : "-"}:${sha256(readFileSync(absolute))}`;
  } catch {
    return CI_TEST_INPUT_UNREADABLE;
  }
}

function inputDigest(absolute) {
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch (error) {
    return missing(error) ? "absent" : CI_TEST_INPUT_UNREADABLE;
  }
  if (!stats.isSymbolicLink()) return followedDigest(absolute);
  try {
    return `link:${readlinkSync(absolute)}>${followedDigest(absolute)}`;
  } catch {
    return CI_TEST_INPUT_UNREADABLE;
  }
}

/** A copied subtree: every entry's relative path, kind and digest, without following links. */
function treeDigest(absolute) {
  const top = inputDigest(absolute);
  if (top !== "directory") return top;
  let names;
  try {
    names = readdirSync(absolute, { recursive: true }).map(String).sort();
  } catch {
    return CI_TEST_INPUT_UNREADABLE;
  }
  if (names.length > maximumTreeEntries) return CI_TEST_INPUT_UNREADABLE;
  const lines = names.map((name) => `${name}\t${inputDigest(resolve(absolute, name))}`);
  if (lines.some((line) => line.endsWith(`\t${CI_TEST_INPUT_UNREADABLE}`)))
    return CI_TEST_INPUT_UNREADABLE;
  return `tree:${sha256(lines.join("\n"))}`;
}

/** The listing digest the recorder produces for a plain or recursive listing, or `null`. */
function listingDigest(absolute, recursive) {
  try {
    const names = readdirSync(absolute, { recursive }).map(String);
    return `sha256:${sha256(ciTestListingText(names, recursive))}`;
  } catch {
    return null;
  }
}

/** Same rule as the recorder: a path exists unless `stat` says it has no entry. */
function exists(absolute) {
  try {
    return statSync(absolute, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
}

/**
 * Returns the reconstructed tree's inputs as memoized lookups by repository-relative path:
 * `input`, `tree`, `listing(path, recursive)` and `exists`. A recursive listing is computed only
 * when asked for, because one of the repository root walks every installed dependency.
 */
export function createCiTestInputSnapshot(repositoryRoot) {
  const memo = (compute) => {
    const values = new Map();
    return (path, ...options) => {
      const key = options.length === 0 ? path : `${options.join(",")}:${path}`;
      if (!values.has(key)) values.set(key, compute(resolve(repositoryRoot, path), ...options));
      return values.get(key);
    };
  };
  return {
    input: memo(inputDigest),
    tree: memo(treeDigest),
    listing: memo(listingDigest),
    exists: memo(exists),
  };
}
