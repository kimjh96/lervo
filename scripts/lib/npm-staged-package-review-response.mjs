import { sha256 } from "./release-artifact-manifest.mjs";

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const sha1Pattern = /^[a-f0-9]{40}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const maximumStageCount = 100;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeStage(value) {
  if (
    !object(value) ||
    !uuidPattern.test(value.id ?? "") ||
    value.packageName !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(value.version ?? "") ||
    !["latest", "next"].includes(value.tag) ||
    !timestampPattern.test(value.createdAt ?? "") ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !sha1Pattern.test(value.shasum ?? "")
  )
    throw new TypeError("npm stage response is invalid");
  return {
    id: value.id,
    idDigest: sha256(value.id),
    package: value.packageName,
    version: value.version,
    distTag: value.tag,
    createdAt: value.createdAt,
    shasum: value.shasum,
  };
}
function parseJson(stdout) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 256 * 1024) {
    throw new TypeError("npm stage response is invalid");
  }
  return JSON.parse(stdout);
}

export function parseNpmStageList(stdout, version) {
  const stages = parseNpmStageListResponse(stdout);
  const matches = stages.filter((stage) => stage.version === version);
  if (matches.length === 0) return { state: "unavailable", reason: "stage_not_found" };
  if (matches.length !== 1) return { state: "unavailable", reason: "stage_ambiguous" };
  return { state: "selected", stage: matches[0] };
}

export function parseNpmStageListResponse(stdout) {
  const response = parseJson(stdout);
  if (!Array.isArray(response) || response.length > maximumStageCount) {
    throw new TypeError("npm stage list response is invalid");
  }
  return response.map(normalizeStage);
}

export function parseNpmStageView(stdout) {
  return normalizeStage(parseJson(stdout));
}

export function sameNpmStage(left, right) {
  return (
    left.id === right.id &&
    left.idDigest === right.idDigest &&
    left.package === right.package &&
    left.version === right.version &&
    left.distTag === right.distTag &&
    left.createdAt === right.createdAt &&
    left.shasum === right.shasum
  );
}

export function publicNpmStage(stage) {
  return {
    idDigest: stage.idDigest,
    createdAt: stage.createdAt,
    distTag: stage.distTag,
    shasum: stage.shasum,
  };
}
