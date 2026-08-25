import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const excludedSegments = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "test",
  "tests",
  "fixtures",
  "__fixtures__",
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sourceLineCount(content) {
  if (content.length === 0) return 0;
  const lines = content.split("\n").length;
  return content.endsWith("\n") ? lines - 1 : lines;
}

function isProductionSource(path) {
  const segments = path.split("/");
  if (segments.some((segment) => excludedSegments.has(segment))) return false;
  if (path.startsWith("apps/hub/assets/")) return false;
  if (/\.(?:test|spec)\.[^.]+$/u.test(path)) return false;
  const extension = path.slice(path.lastIndexOf("."));
  return sourceExtensions.has(extension);
}

async function walk(root, current, files) {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    const repositoryPath = relative(root, absolute).split(sep).join("/");
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (!excludedSegments.has(entry.name)) await walk(root, absolute, files);
      continue;
    }
    if (entry.isFile() && isProductionSource(repositoryPath)) files.push(repositoryPath);
  }
}

function validReview(review) {
  return (
    review !== null &&
    typeof review === "object" &&
    typeof review.path === "string" &&
    /^sha256:[a-f0-9]{64}$/u.test(review.contentHash) &&
    typeof review.responsibility === "string" &&
    review.responsibility.length >= 8 &&
    review.responsibility.length <= 160 &&
    typeof review.rationale === "string" &&
    review.rationale.length >= 30 &&
    review.rationale.length <= 500 &&
    review.disposition === "cohesive"
  );
}

export async function inspectCodeConventionReviews(input) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const reviewPath = input.reviewPath ?? "scripts/code-convention-reviews.json";
  const reviewSource = JSON.parse(await readFile(resolve(repositoryRoot, reviewPath), "utf8"));
  const issues = [];
  if (
    reviewSource?.schemaVersion !== 1 ||
    reviewSource.reviewLineThreshold !== 400 ||
    !Array.isArray(reviewSource.reviews)
  ) {
    return {
      files: [],
      reviews: [],
      issues: ["The code-convention review registry does not satisfy schema v1."],
    };
  }
  const sourcePaths = [];
  for (const sourceRoot of ["apps", "packages", "scripts"])
    await walk(repositoryRoot, resolve(repositoryRoot, sourceRoot), sourcePaths);
  sourcePaths.sort();
  const files = [];
  for (const path of sourcePaths) {
    const absolute = resolve(repositoryRoot, path);
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) continue;
    const bytes = await readFile(absolute);
    const lineCount = sourceLineCount(bytes.toString("utf8"));
    if (lineCount < reviewSource.reviewLineThreshold) continue;
    files.push({ path, contentHash: sha256(bytes), lineCount });
  }
  const reviews = reviewSource.reviews;
  const sortedPaths = reviews.map((review) => review?.path);
  if (new Set(sortedPaths).size !== sortedPaths.length)
    issues.push("The code-convention review registry contains duplicate paths.");
  if (sortedPaths.join("\n") !== [...sortedPaths].sort().join("\n"))
    issues.push("The code-convention review registry paths are not sorted.");
  for (const review of reviews)
    if (!validReview(review))
      issues.push(`The code-convention review for ${review?.path ?? "unknown"} is invalid.`);
  const reviewByPath = new Map(reviews.map((review) => [review.path, review]));
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  for (const file of files) {
    const review = reviewByPath.get(file.path);
    if (review === undefined) {
      issues.push(`${file.path} reached ${file.lineCount} lines without a structural review.`);
      continue;
    }
    if (review.contentHash !== file.contentHash)
      issues.push(`${file.path} changed after its structural review.`);
  }
  for (const review of reviews)
    if (!fileByPath.has(review.path))
      issues.push(`${review.path} no longer requires a long-module structural review.`);
  return { files, reviews, issues };
}

async function main() {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const result = await inspectCodeConventionReviews({ repositoryRoot });
  if (result.issues.length > 0) {
    process.stderr.write(
      `Code-convention structural review failed (${result.issues.length}):\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Code-convention structural review passed (${result.files.length} long production modules).\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await main();
