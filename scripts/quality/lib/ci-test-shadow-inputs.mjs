import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";

const { ciTestDirentType, ciTestListingDigest } = createRequire(import.meta.url)(
  "./ci-test-input-listing.cjs",
);

/**
 * Digests recorded test inputs in a reconstructed CI tree (ADR-0565, Stage 2): the checkout, its
 * frozen dependency install and the restored build, before any test runs. The shadow predictor
 * compares these digests between the run that recorded a closure and the current head.
 *
 * A digest is a plain JSON value with a `kind`. Metadata inputs keep the type, the full permission
 * bits, the size and a link's target; file inputs also keep a SHA-256 of their bytes. A link also
 * keeps the digest of what it resolves to. Modification times are left out, because every
 * checkout changes them, so a test that asserts on a repository file's time is not reusable.
 * Anything that cannot be inspected, or passes a bound, is `{ kind: "unknown" }`, and a digest
 * that contains one anywhere never equals anything.
 */
const maximumFileBytes = 512 * 1024 * 1024;
const maximumTreeEntries = 50_000;
const unknown = (reason) => ({ kind: "unknown", reason });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const missing = (error) => error?.code === "ENOENT" || error?.code === "ENOTDIR";
const permissions = (stats) => stats.mode & 0o7777;

function typeOf(stats) {
  if (stats.isFile()) return "file";
  if (stats.isDirectory()) return "directory";
  if (stats.isSymbolicLink()) return "link";
  if (stats.isFIFO()) return "fifo";
  if (stats.isSocket()) return "socket";
  return "device";
}

/** Recursive JSON with sorted object keys, so equal digests always serialize equally. */
export function canonicalCiTestDigest(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalCiTestDigest).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalCiTestDigest(value[key])}`)
    .join(",")}}`;
}

/** Whether a digest is fully known: a missing value or an `unknown` anywhere inside is not. */
export function isCertainCiTestDigest(value) {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.every(isCertainCiTestDigest);
  if (value === null || typeof value !== "object") return true;
  if (value.kind === "unknown") return false;
  return Object.values(value).every(isCertainCiTestDigest);
}

/** Two digests name the same input only when both are certain and serialize identically. */
export function sameCiTestDigest(left, right) {
  return (
    isCertainCiTestDigest(left) &&
    isCertainCiTestDigest(right) &&
    canonicalCiTestDigest(left) === canonicalCiTestDigest(right)
  );
}

function describe(stats, absolute) {
  const type = typeOf(stats);
  if (type === "directory") return { kind: "directory", mode: permissions(stats) };
  if (type !== "file") return { kind: "other", type, mode: permissions(stats) };
  if (stats.size > maximumFileBytes) return unknown("file_too_large");
  return {
    kind: "file",
    mode: permissions(stats),
    size: stats.size,
    sha256: sha256(readFileSync(absolute)),
  };
}

/** What a path resolves to after following every link. */
function followedDigest(absolute) {
  try {
    return describe(statSync(absolute), absolute);
  } catch (error) {
    return missing(error) ? { kind: "absent" } : unknown("unreadable");
  }
}

function inputDigest(absolute) {
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch (error) {
    return missing(error) ? { kind: "absent" } : unknown("unreadable");
  }
  if (!stats.isSymbolicLink()) {
    try {
      return describe(stats, absolute);
    } catch {
      return unknown("unreadable");
    }
  }
  try {
    return {
      kind: "link",
      mode: permissions(stats),
      target: readlinkSync(absolute),
      resolved: followedDigest(absolute),
    };
  } catch {
    return unknown("unreadable");
  }
}

/** Every entry below a directory, without following links: `[relative path, digest]`. */
function physicalEntries(absolute) {
  const names = readdirSync(absolute, { recursive: true }).map(String).sort();
  if (names.length > maximumTreeEntries) return null;
  return names.map((name) => [name, inputDigest(resolve(absolute, name))]);
}

/** Every entry below a directory, following links as a dereferencing copy does. */
function dereferencedEntries(absolute) {
  const entries = [];
  const seen = new Set();
  const walk = (directory, prefix) => {
    const real = realpathSync(directory);
    if (seen.has(real)) throw new Error("ci_test_tree_cycle");
    seen.add(real);
    for (const name of readdirSync(directory).map(String).sort()) {
      const path = join(directory, name);
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      const digest = followedDigest(path);
      entries.push([relative, digest]);
      if (entries.length > maximumTreeEntries) throw new Error("ci_test_tree_bound");
      if (digest.kind === "directory") walk(path, relative);
    }
    seen.delete(real);
  };
  walk(absolute, "");
  return entries;
}

/**
 * A copied path, seen both as a copy that keeps links and as one that follows them, because the
 * observed call may have done either. Both views must match for the tree to match.
 */
function treeDigest(absolute) {
  const top = inputDigest(absolute);
  const followed = top.kind === "link" ? top.resolved : top;
  if (top.kind !== "directory" && followed.kind !== "directory") return top;
  try {
    const physical = top.kind === "directory" ? physicalEntries(absolute) : [];
    const dereferenced = dereferencedEntries(absolute);
    if (physical === null) return unknown("tree_too_large");
    const tree = { kind: "tree", top, physical, dereferenced };
    return isCertainCiTestDigest(tree)
      ? { kind: "tree", top, sha256: sha256(canonicalCiTestDigest(tree)) }
      : unknown("tree_unreadable");
  } catch {
    return unknown("tree_unreadable");
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

function listingDigest(absolute, recursive) {
  try {
    return ciTestListingDigest({ readdirSync, createHash }, absolute, recursive);
  } catch {
    return null;
  }
}

/** Typed entries of a directory whose names could answer a module request for `stem`. */
function stemEntries(directory, stem) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter(({ name }) => name === stem || name.startsWith(`${stem}.`))
      .map((dirent) => [dirent.name, ciTestDirentType(dirent)])
      .sort(([left], [right]) => (left < right ? -1 : 1));
  } catch (error) {
    return missing(error) ? [] : null;
  }
}

/**
 * Module resolution probes files that are never read: `./x` tries `x`, `x.js`, `x.ts`, `x/` and
 * more, and Vite resolves in the main Vitest process, which no file's record sees. The
 * neighbours of an input are the entries next to it that share its stem, and for an `index.*`
 * file also those next to its directory, so a new file that would win the resolution is a change.
 */
function neighbourDigest(repositoryRoot, path) {
  const name = basename(path);
  const extension = name.lastIndexOf(".");
  const stem = extension > 0 ? name.slice(0, extension) : name;
  const directory = resolve(repositoryRoot, dirname(path));
  const own = stemEntries(directory, stem);
  if (own === null) return unknown("unlisted");
  if (stem !== "index") return { kind: "neighbours", own };
  const parent = stemEntries(dirname(directory), basename(directory));
  return parent === null ? unknown("unlisted") : { kind: "neighbours", own, parent };
}

/**
 * The `package.json` paths Node consults for an input's module type and package scope: one in
 * every directory from the input's own up to the repository root.
 */
export function ciTestPackageScopes(path) {
  const scopes = [];
  const parts = path.split("/").slice(0, -1);
  for (let length = parts.length; length >= 0; length -= 1)
    scopes.push([...parts.slice(0, length), "package.json"].join("/"));
  return scopes.filter((scope) => scope !== path);
}

/**
 * Returns the reconstructed tree's inputs as memoized lookups by repository-relative path:
 * `input`, `tree`, `neighbours`, `listing(path, recursive)` and `exists`. A recursive listing is
 * computed only when asked for, because one of the repository root walks every dependency.
 */
export function createCiTestInputSnapshot(repositoryRoot) {
  const memo = (compute) => {
    const values = new Map();
    return (path, ...options) => {
      const key = options.length === 0 ? path : `${options.join(",")}:${path}`;
      if (!values.has(key)) values.set(key, compute(path, ...options));
      return values.get(key);
    };
  };
  const at = (path) => resolve(repositoryRoot, path);
  return {
    input: memo((path) => inputDigest(at(path))),
    tree: memo((path) => treeDigest(at(path))),
    neighbours: memo((path) => neighbourDigest(repositoryRoot, path)),
    listing: memo((path, recursive) => listingDigest(at(path), recursive)),
    exists: memo((path) => exists(at(path))),
  };
}
