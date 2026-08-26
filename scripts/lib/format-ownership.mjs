import { readdir, readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";

import { parse } from "yaml";

const normalizationRoot = ".lervo/knowledge/document-normalizations";

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

export async function lervoLifecycleOwnedFormatPaths(repositoryRoot) {
  const paths = new Set();
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
