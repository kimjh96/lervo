import { createHash } from "node:crypto";
import { lstat, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { DocumentRecord } from "@lervo/schemas";

export function deliberationContentHash(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function repositoryRelativePath(root: string, path: string): string {
  const value = relative(root, path).split(sep).join("/");
  if (value.length === 0 || value.startsWith("../") || value === "..") {
    throw new Error("The deliberation runtime document path points outside the repository.");
  }
  return value;
}

function safePathSegment(value: string, label: string): string {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new Error(`${label} is not a safe single path segment.`);
  return value;
}

export async function materializeDeliberationDocument(input: {
  repositoryRoot: string;
  deliberationRoot: string;
  createdAt: string;
  documentId: string;
  directoryName: string;
  filename: string;
  content: string;
  sourceId: string;
}): Promise<DocumentRecord> {
  repositoryRelativePath(input.repositoryRoot, input.deliberationRoot);
  const rootStats = await lstat(input.deliberationRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("The deliberation runtime document root is not a safe directory.");
  }
  const directoryName = safePathSegment(
    input.directoryName,
    "Deliberation document directory name",
  );
  const filename = safePathSegment(input.filename, "Deliberation document filename");
  const temporary = await mkdtemp(resolve(input.deliberationRoot, ".document-"));
  const finalDirectory = resolve(input.deliberationRoot, directoryName);
  const contentPath = resolve(temporary, filename);
  const digest = deliberationContentHash(input.content);
  const manifest = {
    schemaVersion: 1,
    documentId: input.documentId,
    contentHash: digest,
    sourceId: input.sourceId,
  };
  try {
    await Promise.all([
      writeFile(contentPath, input.content, { flag: "wx", mode: 0o600 }),
      writeFile(resolve(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      }),
    ]);
    await rename(temporary, finalDirectory);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  const finalContentPath = resolve(finalDirectory, filename);
  const manifestPath = resolve(finalDirectory, "manifest.json");
  return {
    path: repositoryRelativePath(input.repositoryRoot, finalContentPath),
    kind: "generated",
    responsibleParty: { kind: "lervo", id: "lervo-deliberation-runtime" },
    connectedPaths: [repositoryRelativePath(input.repositoryRoot, finalContentPath)],
    verifiedRevision: digest,
    verifiedAt: input.createdAt,
    reviewIntervalDays: 1,
    ownership: {
      mode: "lervo_generated",
      userContentAllowed: false,
      manifestPath: repositoryRelativePath(input.repositoryRoot, manifestPath),
      inputs: [{ sourceId: input.sourceId, contentHash: digest }],
    },
  };
}
