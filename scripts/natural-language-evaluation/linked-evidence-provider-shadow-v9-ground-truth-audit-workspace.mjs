import { Buffer } from "node:buffer";
import { chmod, link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import {
  auditPacketBytes,
  auditPacketDigest,
  createBlindGroundTruthAuditPacket,
  createBlindGroundTruthAuditReviewTemplate,
} from "./linked-evidence-provider-shadow-v9-ground-truth-audit-contract.mjs";

export const defaultBlindGroundTruthAuditContractPath =
  "benchmarks/search/linked-evidence-provider-shadow-v9-ground-truth-audit.json";

function assertRepositoryRelative(repositoryRoot, path) {
  const absolute = resolve(repositoryRoot, path);
  const fromRoot = relative(repositoryRoot, absolute);
  if (fromRoot === "" || fromRoot.startsWith("..") || fromRoot.includes("/../")) {
    throw new TypeError(`The audit path ${path} is not repository-relative.`);
  }
  return absolute;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sourceRepositoryHead(repositoryPath) {
  const head = (await readFile(resolve(repositoryPath, ".git/HEAD"), "utf8")).trim();
  if (!head.startsWith("ref: ")) return head;
  return (await readFile(resolve(repositoryPath, ".git", head.slice(5)), "utf8")).trim();
}

async function existingBytes(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeImmutableOwnerFile(path, bytes) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const current = await existingBytes(path);
  if (current !== null) {
    if (!current.equals(bytes))
      throw new Error("The immutable audit artifact already has different bytes.");
    await chmod(path, 0o600);
    return "unchanged";
  }
  const stageDirectory = await mkdtemp(resolve(directory, ".packet-"));
  const stagedPath = resolve(stageDirectory, "audit-packet.json");
  try {
    await writeFile(stagedPath, bytes, { flag: "wx", mode: 0o600 });
    try {
      await link(stagedPath, path);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const raced = await existingBytes(path);
      if (raced === null || !raced.equals(bytes)) {
        throw new Error("The immutable audit artifact raced with different bytes.", {
          cause: error,
        });
      }
    }
    await chmod(path, 0o600);
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
  }
  return "created";
}

export async function prepareBlindGroundTruthAuditPacket({
  repositoryRoot,
  contractPath = defaultBlindGroundTruthAuditContractPath,
  write = false,
}) {
  const contract = await readJson(assertRepositoryRelative(repositoryRoot, contractPath));
  const v9Prepared = await readJson(
    assertRepositoryRelative(repositoryRoot, contract.source.v9PreparedPath),
  );
  const phasePrepared = await readJson(
    assertRepositoryRelative(repositoryRoot, contract.source.phasePreparedPath),
  );
  const sourceRepository = assertRepositoryRelative(
    repositoryRoot,
    contract.source.sourceRepositoryPath,
  );
  if ((await sourceRepositoryHead(sourceRepository)) !== contract.source.sourceRepositoryCommit) {
    throw new Error("The exact audit source repository commit is unavailable or changed.");
  }
  const selectedCaseIds = new Set(contract.cases.map((item) => item.caseId));
  const documentIds = new Set(
    v9Prepared.manifest.schedule
      .filter((item) => selectedCaseIds.has(item.caseId))
      .flatMap((item) => item.candidates.map((candidate) => candidate.documentId)),
  );
  const corpusById = new Map(phasePrepared.manifest.corpus.map((item) => [item.documentId, item]));
  const sourceDocuments = await Promise.all(
    [...documentIds].map(async (documentId) => {
      const corpus = corpusById.get(documentId);
      if (corpus === undefined) throw new Error(`The audit source ${documentId} is absent.`);
      return {
        documentId,
        path: corpus.path,
        contentHash: corpus.contentHash,
        body: await readFile(assertRepositoryRelative(sourceRepository, corpus.path), "utf8"),
      };
    }),
  );
  const packet = createBlindGroundTruthAuditPacket({
    contract,
    v9Prepared,
    phasePrepared,
    sourceDocuments,
  });
  const bytes = auditPacketBytes(packet);
  const outputPath = assertRepositoryRelative(repositoryRoot, contract.output.packetPath);
  const reviewTemplate = createBlindGroundTruthAuditReviewTemplate(packet);
  const reviewTemplateBytes = Buffer.from(`${JSON.stringify(reviewTemplate, null, 2)}\n`, "utf8");
  const reviewTemplatePath = assertRepositoryRelative(
    repositoryRoot,
    contract.output.reviewTemplatePath,
  );
  const packetDisposition = write
    ? await writeImmutableOwnerFile(outputPath, bytes)
    : "not_written";
  const reviewTemplateDisposition = write
    ? await writeImmutableOwnerFile(reviewTemplatePath, reviewTemplateBytes)
    : "not_written";
  return {
    schemaVersion: 1,
    auditId: contract.auditId,
    status: packet.status,
    packetDigest: auditPacketDigest(packet),
    packetPath: contract.output.packetPath,
    reviewTemplateDigest: auditPacketDigest(reviewTemplate),
    reviewTemplatePath: contract.output.reviewTemplatePath,
    caseCount: packet.cases.length,
    candidateCount: packet.cases.reduce((sum, item) => sum + item.candidateCount, 0),
    candidateBodyBytes: packet.candidateBodyBytes,
    providerInvocationsAuthorized: contract.authority.maximumProviderInvocationsAuthorized,
    groundTruthMutationAuthorized: contract.authority.groundTruthMutationAuthorized,
    packetDisposition,
    reviewTemplateDisposition,
  };
}
