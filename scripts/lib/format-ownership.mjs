import { readdir, readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";

import { parse } from "yaml";

const normalizationRoot = ".lervo/knowledge/document-normalizations";
const documentManifestRoot = ".lervo/documents";
const legacyDocumentRegistry = ".lervo/documents.yaml";

function validRepositoryPath(path) {
  return (
    typeof path === "string" &&
    path !== "" &&
    path === posix.normalize(path) &&
    !posix.isAbsolute(path) &&
    path !== ".." &&
    !path.startsWith("../")
  );
}

async function normalizationRecordPaths(repositoryRoot) {
  try {
    const entries = await readdir(resolve(repositoryRoot, normalizationRoot), {
      recursive: true,
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => resolve(entry.parentPath, entry.name))
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function registryRecords(repositoryRoot) {
  let sharded = [];
  let legacy = null;
  try {
    const entries = await readdir(resolve(repositoryRoot, documentManifestRoot), {
      withFileTypes: true,
    });
    sharded = await Promise.all(
      entries
        .filter(
          (entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".yaml"),
        )
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          const manifest = parse(
            await readFile(resolve(repositoryRoot, documentManifestRoot, entry.name), "utf8"),
          );
          if (manifest?.schemaVersion !== 1 || manifest?.record === undefined)
            throw new Error(`Invalid Lervo document manifest: ${entry.name}`);
          return manifest.record;
        }),
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    legacy = parse(await readFile(resolve(repositoryRoot, legacyDocumentRegistry), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (sharded.length > 0 && legacy !== null)
    throw new Error("Lervo document ownership storage is ambiguous.");
  if (legacy !== null) {
    if (
      legacy?.schemaVersion !== 1 ||
      typeof legacy?.documents !== "object" ||
      legacy.documents === null
    )
      throw new Error("Invalid legacy Lervo document ownership registry.");
    return Object.values(legacy.documents);
  }
  return sharded;
}

export async function lervoLifecycleOwnedFormatPaths(repositoryRoot) {
  const paths = new Set();
  for (const record of await registryRecords(repositoryRoot)) {
    const mode = record?.ownership?.mode;
    if (
      !validRepositoryPath(record?.path) ||
      !["user", "managed_blocks", "lervo_generated"].includes(mode)
    )
      throw new Error("Invalid Lervo document ownership record.");
    if (mode !== "user") paths.add(record.path);
  }
  for (const recordPath of await normalizationRecordPaths(repositoryRoot)) {
    const record = parse(await readFile(recordPath, "utf8"));
    if (
      ![1, 2].includes(record?.schemaVersion) ||
      (record.schemaVersion === 2 &&
        (record.byteOwnership?.owner !== "reviewer" ||
          record.byteOwnership?.rewritePolicy !== "reviewed_exact")) ||
      !Array.isArray(record.outputs) ||
      record.outputs.length === 0
    )
      throw new Error(`Invalid Lervo normalization ownership record: ${recordPath}`);
    for (const output of record.outputs) {
      if (!validRepositoryPath(output?.path))
        throw new Error(`Unsafe Lervo normalization output path: ${recordPath}`);
      paths.add(output.path);
    }
  }
  return paths;
}
