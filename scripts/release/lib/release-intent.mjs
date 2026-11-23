import { createHash } from "node:crypto";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, stringify } from "yaml";

const intentIdPattern = /^relint_[a-f0-9]{24}$/u;
const summaryPattern = /^(?=.*[A-Za-z])[\x20-\x7E]{20,280}$/u;
const maximumPendingIntents = 128;

/**
 * Each version line's intents (ADR-0615): the CLI's in `.changes/`, the ADE's in `.changes/ade/`.
 * Every reader sees one directory level, so no CLI tool ever reads an ADE intent.
 */
export const releaseTargets = Object.freeze({
  cli: Object.freeze({ package: "@lervo/cli", directory: ".changes" }),
  ade: Object.freeze({ package: "@lervo/ade", directory: ".changes/ade" }),
});

function releaseTarget(name) {
  if (!Object.hasOwn(releaseTargets, name))
    throw new ReleaseIntentError("release_target_unknown", `Release target ${name} is unknown.`);
  return releaseTargets[name];
}

export class ReleaseIntentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseIntentError";
    this.code = code;
  }
}

export function releaseDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function validateReleaseIntent(value, filename, target = "cli") {
  const expectedPackage = releaseTarget(target).package;
  const expectedIntentId =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.impact === "string" &&
    typeof value.summary === "string"
      ? `relint_${releaseDigest({
          package: value.package,
          impact: value.impact,
          summary: value.summary,
        }).slice("sha256:".length, "sha256:".length + 24)}`
      : null;
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    typeof value.intentId !== "string" ||
    !intentIdPattern.test(value.intentId) ||
    value.intentId !== expectedIntentId ||
    filename !== `${value.intentId}.yaml` ||
    value.package !== expectedPackage ||
    !["patch", "minor", "major"].includes(value.impact) ||
    typeof value.summary !== "string" ||
    !summaryPattern.test(value.summary) ||
    Object.keys(value).toSorted().join(",") !==
      ["impact", "intentId", "package", "schemaVersion", "summary"].join(",")
  )
    throw new ReleaseIntentError(
      "release_intent_invalid",
      `Release intent ${filename} does not satisfy the bounded v1 contract.`,
    );
  return structuredClone(value);
}

export async function loadReleaseIntents(repositoryRoot, target = "cli") {
  const { directory: relative } = releaseTarget(target);
  const directory = resolve(repositoryRoot, relative);
  let filenames;
  try {
    filenames = (await readdir(directory)).filter((name) => name.endsWith(".yaml")).toSorted();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  if (filenames.length > maximumPendingIntents)
    throw new ReleaseIntentError(
      "release_intent_limit_exceeded",
      `Pending release intent exceeds the bounded limit of ${maximumPendingIntents}.`,
    );
  const intents = [];
  const seen = new Set();
  for (const filename of filenames) {
    const source = await readFile(resolve(directory, filename), "utf8");
    const intent = validateReleaseIntent(parse(source), filename, target);
    if (seen.has(intent.intentId))
      throw new ReleaseIntentError(
        "release_intent_duplicate",
        `Release intent ${intent.intentId} is duplicated.`,
      );
    seen.add(intent.intentId);
    intents.push({
      ...intent,
      path: `${relative}/${filename}`,
      contentHash: releaseDigest(source),
    });
  }
  return intents;
}

export async function createReleaseIntent(repositoryRoot, input) {
  const target = input.target ?? "cli";
  const { package: packageName, directory: relative } = releaseTarget(target);
  const identity = {
    package: packageName,
    impact: input.impact,
    summary: input.summary,
  };
  const intentId = `relint_${releaseDigest(identity).slice("sha256:".length, "sha256:".length + 24)}`;
  const intent = validateReleaseIntent(
    { schemaVersion: 1, intentId, ...identity },
    `${intentId}.yaml`,
    target,
  );
  const directory = resolve(repositoryRoot, relative);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${intentId}.yaml`);
  const content = stringify(intent, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE" });
  try {
    const current = await readFile(path, "utf8");
    if (current !== content)
      throw new ReleaseIntentError(
        "release_intent_conflict",
        `Release intent ${intentId} already exists with different bytes.`,
      );
    return { created: false, intent, path: `${relative}/${intentId}.yaml` };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const pendingCount = (await readdir(directory)).filter((name) => name.endsWith(".yaml")).length;
  if (pendingCount >= maximumPendingIntents)
    throw new ReleaseIntentError(
      "release_intent_limit_exceeded",
      `Pending release intent reached the bounded limit of ${maximumPendingIntents}.`,
    );
  await writeFile(path, content, { flag: "wx" });
  return { created: true, intent, path: `${relative}/${intentId}.yaml` };
}
