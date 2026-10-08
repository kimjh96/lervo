import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalJson, sha256 } from "./integrity.js";
import type { DocumentFreshnessAssessmentV1 } from "./document-freshness-assessment.js";
import { openReadOnlyProjectStorage } from "@lervo/project-storage";

const PATH = ".lervo/state/knowledge/document-freshness-assessments.json";
const MAXIMUM_BYTES = 8 * 1024 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const relativePath = (path: unknown): path is string =>
  typeof path === "string" &&
  path.length > 0 &&
  path.length <= 1024 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.includes("\0") &&
  !path.split("/").some((part) => part === ".." || part === "." || part === "");
interface Record {
  receiptHash: string;
  assessment: DocumentFreshnessAssessmentV1;
}

/** One bounded projection of hash-bound canonical assessment receipts. Invalid entries prove nothing. */
export async function readDocumentFreshnessAssessments(root: string): Promise<Record[]> {
  try {
    const path = resolve(root, PATH);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAXIMUM_BYTES) return [];
    const value = JSON.parse(await readFile(path, "utf8")) as {
      schemaVersion?: unknown;
      records?: unknown;
    };
    if (value.schemaVersion !== 1 || !Array.isArray(value.records) || value.records.length > 4096)
      return [];
    const records = value.records.filter((item: unknown): item is Record => {
      const record = item as Partial<Record> | null;
      const a = record?.assessment;
      return (
        typeof record?.receiptHash === "string" &&
        HASH.test(record.receiptHash) &&
        a?.schemaVersion === 1 &&
        relativePath(a.documentPath) &&
        typeof a.documentHash === "string" &&
        HASH.test(a.documentHash) &&
        typeof a.assessedRevision === "string" &&
        typeof a.assessedAt === "string" &&
        Number.isFinite(Date.parse(a.assessedAt)) &&
        a.outcome === "verified_no_change" &&
        typeof a.reviewerIdentity === "string" &&
        typeof a.verificationContractHash === "string" &&
        Array.isArray(a.dependency?.objects) &&
        a.dependency.objects.length <= 256 &&
        a.dependency.objects.every(
          (object) =>
            relativePath(object.path) &&
            (object.objectName === null || typeof object.objectName === "string"),
        ) &&
        Array.isArray(a.dependency.evidence) &&
        a.dependency.evidence.length <= 256 &&
        a.dependency.evidence.every((item) => relativePath(item.path) && HASH.test(item.hash)) &&
        sha256(canonicalJson(a)) === record.receiptHash
      );
    });
    if (records.length === 0) return [];
    const storage = await openReadOnlyProjectStorage(root);
    try {
      const verified: Record[] = [];
      for (const record of records) {
        const identity = sha256(
          canonicalJson(["document.freshness.assessment.recorded", record.receiptHash]),
        ).slice(7, 39);
        const event = storage.events.get(`evt_${identity}`);
        if (
          event?.type !== "document.freshness.assessment.recorded" ||
          event.payload.receiptHash !== record.receiptHash ||
          event.payload.documentHash !== record.assessment.documentHash ||
          event.payload.dependencyDigest !== record.assessment.dependencyDigest
        )
          continue;
        const bytes = await storage.artifacts
          .get(`lervo-cas://sha256/${record.receiptHash.slice(7)}`)
          .catch(() => null);
        if (
          bytes !== null &&
          sha256(bytes) === record.receiptHash &&
          canonicalJson(record.assessment) ===
            new TextDecoder("utf8", { fatal: true }).decode(bytes)
        )
          verified.push(record);
      }
      return verified;
    } finally {
      await storage.close();
    }
  } catch {
    return [];
  }
}

export async function storeDocumentFreshnessAssessment(
  root: string,
  record: Record,
): Promise<void> {
  if (sha256(canonicalJson(record.assessment)) !== record.receiptHash)
    throw new Error("Freshness assessment receipt is invalid.");
  const records = (await readDocumentFreshnessAssessments(root)).filter(
    (item) => item.assessment.documentPath !== record.assessment.documentPath,
  );
  const retained = [];
  for (const item of records) {
    const stat = await lstat(resolve(root, item.assessment.documentPath)).catch(() => null);
    if (stat?.isFile() && !stat.isSymbolicLink()) retained.push(item);
  }
  retained.push(record);
  const bytes = canonicalJson({ schemaVersion: 1, records: retained });
  if (retained.length > 4096 || Buffer.byteLength(bytes) > MAXIMUM_BYTES)
    throw Object.assign(new Error("Freshness assessment capacity exceeded."), {
      code: "freshness_assessment_capacity",
    });
  const path = resolve(root, PATH),
    temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
