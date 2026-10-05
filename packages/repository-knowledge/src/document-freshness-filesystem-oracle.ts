import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { DocumentFreshnessTreeOracle } from "./document-freshness-references.js";

const MAXIMUM_TEXT_BYTES = 1024 * 1024;

/** A read-only filesystem view of the current working tree for reference resolution. */
export function filesystemDocumentFreshnessOracle(root: string): DocumentFreshnessTreeOracle {
  const exists = new Map<string, boolean>();
  return {
    exists(path) {
      let value = exists.get(path);
      if (value === undefined) {
        value = existsSync(resolve(root, path));
        exists.set(path, value);
      }
      return value;
    },
    readText(path) {
      try {
        const stat = lstatSync(resolve(root, path));
        if (!stat.isFile() || stat.size > MAXIMUM_TEXT_BYTES) return null;
        return readFileSync(resolve(root, path), "utf8");
      } catch {
        return null;
      }
    },
    topLevel: (segment) => existsSync(resolve(root, segment)),
  };
}
