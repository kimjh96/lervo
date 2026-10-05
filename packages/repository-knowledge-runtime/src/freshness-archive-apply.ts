import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  applyDocumentFreshnessArchive,
  canonicalJson,
  sha256,
  type DocumentFreshnessCandidateV1,
} from "@lervo/repository-knowledge";

import { committedBlob } from "./freshness-commit.js";
import {
  currentDocumentBytes,
  DocumentFreshnessOperationError,
  writeDocumentBytes,
  type FreshnessStorage,
} from "./freshness-document-io.js";

/**
 * Writes a verified archive: the moved document with its banner and rebased links, every rewritten
 * inbound document, and the removal of the source. The exact pre-images of every touched document
 * go to CAS first, so a revert restores them byte for byte. Throws `source_changed` without writing
 * when the source, a linking document, or the free target moved since verification.
 */
export async function writeFreshnessArchive(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
}): Promise<{ paths: string[]; appliedHash: string; preimageRef: string }> {
  const root = input.storage.paths.repositoryRoot;
  const { candidate } = input;
  const plan = candidate.archive!;
  const source = await currentDocumentBytes(root, candidate.documentPath);
  const committed = await committedBlob(root, candidate.documentPath);
  const inbound: Array<{ path: string; content: string }> = [];
  for (const [path, hash] of Object.entries(plan.inboundSourceHashes)) {
    const bytes = await currentDocumentBytes(root, path);
    if (bytes === null || sha256(bytes.toString("utf8")) !== hash) break;
    inbound.push({ path, content: bytes.toString("utf8") });
  }
  if (
    source === null ||
    committed === null ||
    sha256(source) !== candidate.sourceHash ||
    sha256(committed) !== candidate.sourceHash ||
    inbound.length !== Object.keys(plan.inboundSourceHashes).length ||
    (await currentDocumentBytes(root, plan.targetPath)) !== null
  )
    throw new DocumentFreshnessOperationError(
      "source_changed",
      `${candidate.documentPath} or a document linking to it changed after the archive was verified.`,
    );
  const written = applyDocumentFreshnessArchive({
    plan,
    documentPath: candidate.documentPath,
    content: source.toString("utf8"),
    inboundDocuments: inbound,
  });
  const preimage = await input.storage.artifacts.put(
    canonicalJson({
      schemaVersion: 1,
      kind: "document_freshness.archive_preimage",
      documents: [{ path: candidate.documentPath, content: source.toString("utf8") }, ...inbound],
    }),
  );
  await writeDocumentBytes(root, plan.targetPath, Buffer.from(written.targetContent, "utf8"));
  for (const document of written.inbound)
    await writeDocumentBytes(root, document.path, Buffer.from(document.content, "utf8"));
  await rm(resolve(root, candidate.documentPath));
  return {
    paths: [candidate.documentPath, plan.targetPath, ...written.inbound.map((item) => item.path)],
    appliedHash: sha256(written.targetContent),
    preimageRef: preimage.uri,
  };
}

/**
 * Restores an archive from its CAS pre-image when the moved document still holds the archived
 * bytes; any later edit fails with `revert_conflict` and changes nothing.
 */
export async function restoreFreshnessArchive(input: {
  storage: FreshnessStorage;
  candidate: DocumentFreshnessCandidateV1;
}): Promise<string[]> {
  const root = input.storage.paths.repositoryRoot;
  const { candidate } = input;
  const plan = candidate.archive!;
  const target = await currentDocumentBytes(root, plan.targetPath);
  if (target === null || sha256(target.toString("utf8")) !== candidate.appliedHash)
    throw new DocumentFreshnessOperationError(
      "revert_conflict",
      `Reconcile by hand: ${plan.targetPath} changed after the archive; restore ${candidate.documentPath} from the archive commit and rewrite the inbound links.`,
    );
  const preimage = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await input.storage.artifacts.get(candidate.beforeBytesRef!),
    ),
  ) as { documents: Array<{ path: string; content: string }> };
  for (const document of preimage.documents)
    await writeDocumentBytes(root, document.path, Buffer.from(document.content, "utf8"));
  await rm(resolve(root, plan.targetPath));
  return [plan.targetPath, ...preimage.documents.map((document) => document.path)];
}
