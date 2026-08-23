import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { npmPublicRegistry } from "./release-publication-authorization.mjs";

const maximumResponseBytes = 256 * 1024;
const sha1Pattern = /^[a-f0-9]{40}$/u;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/u;

function unavailable(target) {
  return {
    schemaVersion: 1,
    source: "npm_public_registry_reconciliation",
    state: "unavailable",
    package: target.package,
    version: target.version,
    distTag: target.distTag,
    reason: "registry_unavailable",
  };
}

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_reconciliation_observer_input_invalid",
    "The CLI first-publication reconciliation observation input is invalid.",
  );
}

async function cancel(response) {
  try {
    await response.body?.cancel();
  } catch {
    // The caller receives a controlled unavailable observation.
  }
}

async function readJson(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) throw new Error();
  const reader = response.body?.getReader?.();
  if (reader === undefined) throw new Error();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumResponseBytes) throw new Error();
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch {}
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function requestJson(request, url) {
  const response = await request(url, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) {
    await cancel(response);
    return { state: "not_found" };
  }
  if (!response.ok) {
    await cancel(response);
    throw new Error();
  }
  return { state: "found", value: await readJson(response) };
}

export async function observeFirstPublicationReconciliation(
  target,
  { request = globalThis.fetch } = {},
) {
  if (
    target?.registry !== npmPublicRegistry || target.package !== "@lervo/cli" ||
    !/^\d+\.\d+\.\d+$/u.test(target.version ?? "") ||
    !["latest", "next"].includes(target.distTag) || typeof request !== "function"
  ) fail();
  const encodedPackage = "%40lervo%2Fcli";
  let metadataResult;
  let tagsResult;
  try {
    [metadataResult, tagsResult] = await Promise.all([
      requestJson(request, `${npmPublicRegistry}${encodedPackage}/${target.version}`),
      requestJson(request, `${npmPublicRegistry}-/package/${encodedPackage}/dist-tags`),
    ]);
  } catch {
    return unavailable(target);
  }
  const metadata = metadataResult.value;
  const tags = tagsResult.value;
  if (
    metadataResult.state === "found" &&
    (metadata === null || typeof metadata !== "object" || Array.isArray(metadata) ||
      metadata.name !== target.package || metadata.version !== target.version ||
      !sha512IntegrityPattern.test(metadata.dist?.integrity ?? "") ||
      !sha1Pattern.test(metadata.dist.shasum ?? ""))
  ) return unavailable(target);
  if (
    tagsResult.state === "found" &&
    (tags === null || typeof tags !== "object" || Array.isArray(tags) ||
      (tags[target.distTag] !== undefined && typeof tags[target.distTag] !== "string"))
  ) return unavailable(target);
  return {
    schemaVersion: 1,
    source: "npm_public_registry_reconciliation",
    state: "observed",
    package: target.package,
    version: target.version,
    distTag: target.distTag,
    versionMetadata: metadataResult.state === "found"
      ? {
          state: "found",
          registryIntegrity: metadata.dist.integrity,
          registryShasum: metadata.dist.shasum,
        }
      : { state: "not_found" },
    distTagValue: tagsResult.state === "found" && tags[target.distTag] !== undefined
      ? { state: "found", version: tags[target.distTag] }
      : { state: "not_found" },
  };
}
