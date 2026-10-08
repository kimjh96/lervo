import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  canonicalJson,
  sha256,
  loadRepositoryKnowledgePolicy,
  DOCUMENT_FRESHNESS_ASSESSMENT_CONTRACT,
  documentFreshnessDependencyDigest,
  type DocumentFreshnessFindingV1,
  type DocumentFreshnessDependencyWitness,
} from "@lervo/repository-knowledge";
import {
  freshnessEvidencePathAllowed,
  freshnessObject,
  freshnessGit,
} from "./freshness-git-evidence.js";

export async function captureFreshnessDependencies(input: {
  root: string;
  finding: DocumentFreshnessFindingV1;
  evidence: DocumentFreshnessDependencyWitness["evidence"];
}): Promise<DocumentFreshnessDependencyWitness | null> {
  const paths = [
    ...new Set([
      ...input.finding.connectedPathChanges.flatMap((change) => [
        change.path,
        ...(change.renamedTo === null ? [] : [change.renamedTo]),
      ]),
      ...input.finding.references.map((ref) => ref.target),
      ...input.evidence.map((item) => item.path),
    ]),
  ].sort();
  if (paths.length > 256 || paths.some((path) => !freshnessEvidencePathAllowed(path))) return null;
  try {
    const objects = [];
    for (const path of paths)
      objects.push({
        path,
        objectName:
          (await freshnessObject(input.root, input.finding.currentRevision, path))?.id ?? null,
      });
    return {
      schemaVersion: 1,
      policyHash: sha256(canonicalJson(await loadRepositoryKnowledgePolicy(input.root))),
      verificationContractHash: DOCUMENT_FRESHNESS_ASSESSMENT_CONTRACT,
      referenceDigest: sha256(canonicalJson(input.finding.references)),
      objects,
      evidence: input.evidence,
    };
  } catch {
    return null;
  }
}

/** Recheck Git membership and exact working bytes; unrelated HEAD changes are harmless. */
export async function freshnessDependenciesCurrent(
  root: string,
  witness: DocumentFreshnessDependencyWitness,
): Promise<boolean> {
  try {
    if (
      witness.schemaVersion !== 1 ||
      witness.verificationContractHash !== DOCUMENT_FRESHNESS_ASSESSMENT_CONTRACT ||
      witness.policyHash !== sha256(canonicalJson(await loadRepositoryKnowledgePolicy(root))) ||
      witness.objects.length > 256 ||
      witness.evidence.length > 256
    )
      return false;
    for (const object of witness.objects)
      if (
        (await freshnessObject(root, "HEAD", object.path))?.id !== (object.objectName ?? undefined)
      )
        return false;
    if (
      witness.objects.length > 0 &&
      (await freshnessGit(root, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        ...witness.objects.map((object) => object.path),
      ])) !== ""
    )
      return false;
    for (const item of witness.evidence) {
      if (!freshnessEvidencePathAllowed(item.path)) return false;
      let target = root;
      let absent = false;
      for (const part of item.path.split("/")) {
        target = resolve(target, part);
        const stat = await lstat(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (stat === null) {
          absent = true;
          break;
        }
        if (stat.isSymbolicLink()) return false;
      }
      if (absent) {
        if (
          !witness.objects.some((object) => object.path === item.path && object.objectName === null)
        )
          return false;
      } else if (sha256(await readFile(target)) !== item.hash) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export { documentFreshnessDependencyDigest };
