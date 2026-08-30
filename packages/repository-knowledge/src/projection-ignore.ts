import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256 } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

const BEGIN = "# lervo:begin rebuildable-knowledge schema=1";
const END = "# lervo:end rebuildable-knowledge";

export interface RebuildableKnowledgeIgnoreProjection {
  path: ".gitignore";
  beforeContent: string | null;
  afterContent: string;
  beforeHash: string | null;
  afterHash: string;
  changed: boolean;
}

function normalizedRule(publicationRoot: string): string {
  const root = publicationRoot.replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (root.length === 0 || root.startsWith("/") || root.split("/").includes(".."))
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The rebuildable publication root cannot be represented safely in .gitignore.",
    );
  return `${root}/`;
}

function project(current: string | null, rule: string): string {
  const content = current ?? "";
  const begin = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if ((begin === -1) !== (end === -1) || (begin !== -1 && end < begin))
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The rebuildable knowledge ignore block is malformed.",
    );
  const block = `${BEGIN}\n${rule}\n${END}\n`;
  if (begin === -1)
    return `${content}${content.length === 0 || content.endsWith("\n") ? "" : "\n"}${block}`;
  const afterEnd = end + END.length;
  return `${content.slice(0, begin)}${block}${content.slice(afterEnd).replace(/^\n/u, "")}`;
}

export async function projectRebuildableKnowledgeIgnore(input: {
  repositoryRoot: string;
  publicationRoot: string;
}): Promise<RebuildableKnowledgeIgnoreProjection> {
  const path = resolve(input.repositoryRoot, ".gitignore");
  let beforeContent: string | null = null;
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        ".gitignore is not a safe regular file.",
      );
    beforeContent = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const afterContent = project(beforeContent, normalizedRule(input.publicationRoot));
  return {
    path: ".gitignore",
    beforeContent,
    afterContent,
    beforeHash: beforeContent === null ? null : sha256(beforeContent),
    afterHash: sha256(afterContent),
    changed: beforeContent !== afterContent,
  };
}
