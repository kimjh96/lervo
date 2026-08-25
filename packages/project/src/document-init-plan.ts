import { resolve } from "node:path";

import type { DocumentRegistry } from "@lervo/schemas";

import { parseAndValidateYaml } from "./config.js";
import { loadDocumentManifests } from "./document-storage.js";
import { contentHash, readEntry } from "./filesystem.js";
import { lervoRelativePaths } from "./layout.js";
import type { InitOperation } from "./types.js";

export async function planDocumentStorage(root: string): Promise<InitOperation[]> {
  const documentsPath = lervoRelativePaths.documents;
  const legacyPath = lervoRelativePaths.legacyDocumentRegistry;
  const documentsEntry = await readEntry(resolve(root, documentsPath));
  const legacyEntry = await readEntry(resolve(root, legacyPath));

  if (documentsEntry.kind === "missing" && legacyEntry.kind === "missing") {
    return [];
  }
  if (documentsEntry.kind === "directory" && legacyEntry.kind === "missing") {
    try {
      await loadDocumentManifests(root);
      return [{ kind: "directory", path: documentsPath, action: "unchanged" }];
    } catch (error) {
      return [
        {
          kind: "directory",
          path: documentsPath,
          action: "conflict",
          reason: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  }
  if (documentsEntry.kind === "missing" && legacyEntry.kind === "file") {
    try {
      parseAndValidateYaml<DocumentRegistry>("documentRegistry", legacyEntry.content);
      return [
        {
          kind: "file",
          path: legacyPath,
          action: "unchanged",
          expectedContentHash: contentHash(legacyEntry.content),
        },
      ];
    } catch (error) {
      return [
        {
          kind: "file",
          path: legacyPath,
          action: "conflict",
          reason: error instanceof Error ? error.message : String(error),
        },
      ];
    }
  }

  let documentsOperation: InitOperation;
  if (documentsEntry.kind === "missing") {
    documentsOperation = { kind: "directory", path: documentsPath, action: "create" };
  } else if (documentsEntry.kind === "directory") {
    documentsOperation = { kind: "directory", path: documentsPath, action: "unchanged" };
  } else {
    documentsOperation = {
      kind: "directory",
      path: documentsPath,
      action: "conflict",
      reason: `${documentsPath} must be a real directory. The existing entry was not modified.`,
    };
  }
  const operations: InitOperation[] = [documentsOperation];
  if (legacyEntry.kind !== "missing") {
    operations.push({
      kind: "file",
      path: legacyPath,
      action: "conflict",
      reason: `${documentsPath} and ${legacyPath} cannot be used together. Existing entries were not modified.`,
    });
  }
  return operations;
}
