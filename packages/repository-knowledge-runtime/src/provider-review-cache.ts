import { resolve } from "node:path";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { ArtifactStore } from "@lervo/storage-contract";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

const PATH = ".lervo/state/knowledge/provider-review-cache.json";
const HASH = /^sha256:[a-f0-9]{64}$/u;

async function entries(root: string): Promise<Record<string, string>> {
  const read = await readPrivateJsonFile(resolve(root, PATH), 64 * 1024);
  const value =
    read.status === "read"
      ? (read.value as { schemaVersion?: unknown; entries?: unknown } | null)
      : null;
  if (
    value?.schemaVersion !== 1 ||
    value.entries === null ||
    typeof value.entries !== "object" ||
    Array.isArray(value.entries)
  )
    return {};
  const values = Object.entries(value.entries);
  if (values.length > 256) return {};
  return Object.fromEntries(
    values.filter(([key, hash]) => HASH.test(key) && typeof hash === "string" && HASH.test(hash)),
  );
}

/** Exact request observations survive a quantum yield; every consumer still validates the answer. */
export async function readProviderReviewCache(input: {
  root: string;
  key: string;
  artifacts: ArtifactStore;
}): Promise<unknown | null> {
  const hash = (await entries(input.root))[input.key];
  if (hash === undefined) return null;
  try {
    const bytes = await input.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
    if (bytes.byteLength > 4 * 1024 * 1024 || sha256(bytes) !== hash) return null;
    const record = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as {
      key?: unknown;
      value?: unknown;
    };
    return record.key === input.key ? (record.value ?? null) : null;
  } catch {
    return null;
  }
}

export async function storeProviderReviewCache(input: {
  root: string;
  key: string;
  value: unknown;
  artifacts: ArtifactStore;
}): Promise<void> {
  const receipt = await input.artifacts.put(canonicalJson({ key: input.key, value: input.value }));
  const current = await entries(input.root);
  delete current[input.key];
  current[input.key] = receipt.contentHash;
  await writePrivateJsonFile(resolve(input.root, PATH), {
    schemaVersion: 1,
    entries: Object.fromEntries(Object.entries(current).slice(-256)),
  });
}
