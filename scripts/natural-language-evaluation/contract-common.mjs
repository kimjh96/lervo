import { createHash } from "node:crypto";

export function fail(message) {
  throw new Error(`Natural-language evaluation contract failed: ${message}`);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

export function canonicalDigest(value, trailingNewline = false) {
  const bytes = `${JSON.stringify(canonical(value))}${trailingNewline ? "\n" : ""}`;
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function record(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} is not an object`);
  }
  return value;
}

export function boundedString(value, label, maximum = 4_096) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    fail(`${label} is not bounded text`);
  }
  return value;
}

export function boundedArray(value, label, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail(`${label} has an invalid item count`);
  }
  return value;
}

export function uniqueStrings(values, label, allowed) {
  const items = values.map((value, index) => boundedString(value, `${label}[${index}]`, 128));
  if (new Set(items).size !== items.length) fail(`${label} contains duplicates`);
  if (allowed !== undefined && items.some((item) => !allowed.has(item))) {
    fail(`${label} contains an unsupported value`);
  }
  return items;
}

export function repositoryPath(path, label) {
  const value = boundedString(path, label, 500);
  if (value.startsWith("/") || value.includes("\\") || value.split("/").includes("..")) {
    fail(`${label} is not repository-relative`);
  }
  return value;
}
