import { constants } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { RepositoryKnowledgeError } from "./types.js";

import type {
  DocumentNormalizationEnvelope,
  DocumentNormalizationResponse,
  RepositoryDocumentNormalizationCompiler,
} from "./document-normalization.js";

const MAX_SHARD_CACHE_BYTES = 4 * 1024 * 1024;

async function hashAt(path: string): Promise<string | null> {
  try {
    return sha256(await readFile(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function createDocumentNormalizationShardCache(input: {
  repositoryRoot: string;
  compiler: RepositoryDocumentNormalizationCompiler;
}): {
  load(envelope: DocumentNormalizationEnvelope): Promise<unknown | null>;
  store(
    envelope: DocumentNormalizationEnvelope,
    response: DocumentNormalizationResponse,
  ): Promise<void>;
} {
  const root = resolve(input.repositoryRoot);
  const cacheInput = (envelope: DocumentNormalizationEnvelope): unknown => ({
    cacheContract: "document-v2",
    compiler: input.compiler.descriptor,
    envelope: {
      schemaVersion: envelope.schemaVersion,
      outputLanguage: envelope.outputLanguage,
      formatVersion: envelope.formatVersion,
      control: envelope.control,
      documents: envelope.documents,
    },
  });
  const cacheId = (envelope: DocumentNormalizationEnvelope): string =>
    stableId("knormcache", cacheInput(envelope));
  const cachePath = (envelope: DocumentNormalizationEnvelope): string =>
    shardedKnowledgeArtifactPath(
      ".lervo/state/knowledge/normalization-shards",
      cacheId(envelope),
      "json",
    );
  return {
    async load(envelope) {
      try {
        const bytes = await readFile(resolve(root, cachePath(envelope)));
        if (bytes.byteLength > MAX_SHARD_CACHE_BYTES) return null;
        const stored = JSON.parse(bytes.toString("utf8")) as {
          schemaVersion?: unknown;
          cacheId?: unknown;
          response?: unknown;
        };
        return stored.schemaVersion === 1 && stored.cacheId === cacheId(envelope)
          ? (stored.response ?? null)
          : null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
          return null;
        throw error;
      }
    },
    async store(envelope, response) {
      const id = cacheId(envelope);
      const absolute = resolve(root, cachePath(envelope));
      const bytes = Buffer.from(
        `${canonicalJson({ schemaVersion: 1, cacheContract: "document-v2", cacheId: id, compiler: input.compiler.descriptor, documentInputHash: sha256(canonicalJson(cacheInput(envelope))), response })}\n`,
      );
      if (bytes.byteLength > MAX_SHARD_CACHE_BYTES)
        throw new RepositoryKnowledgeError(
          "knowledge_source_limit_exceeded",
          "A document normalization shard cache exceeds the artifact limit.",
        );
      await mkdir(dirname(absolute), { recursive: true, mode: 0o700 });
      if ((await hashAt(absolute)) !== null) return;
      let handle;
      try {
        handle = await open(
          absolute,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
          0o600,
        );
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle?.close();
      }
    },
  };
}
