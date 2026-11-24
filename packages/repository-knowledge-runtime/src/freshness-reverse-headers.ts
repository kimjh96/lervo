import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  documentFreshnessOwnershipResolver,
  filesystemDocumentFreshnessOracle,
  readRelationWebStore,
  reverseHeaderCandidate,
  reverseHeaderDeclarations,
  sha256,
  RELATION_WEB_STATE_PATH,
  type DocumentFreshnessCandidateV1,
  type DocumentFreshnessHold,
  type DocumentFreshnessPolicy,
  type ReverseHeaderDeclaration,
} from "@lervo/repository-knowledge";

import { knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { loadConvergenceDelegation, pathWithinConvergenceRoots } from "./delegation.js";
import { applyVerifiedFreshness } from "./freshness-auto-apply.js";
import { committedBlob } from "./freshness-commit.js";
import { workingBytes } from "./freshness-cycle-observation.js";
import type { FreshnessStorage } from "./freshness-document-io.js";
import { recordFreshnessCandidateOutcome } from "./freshness-events.js";
import {
  listFreshnessCandidates,
  listFreshnessHolds,
  writeFreshnessCandidate,
} from "./freshness-state-store.js";
import {
  KNOWLEDGE_OUTPUT_COMMIT_AUTHOR,
  knowledgeOutputCommitSafe,
} from "./knowledge-output-commit.js";

const execute = promisify(execFile);

/** Reverse header records one freshness cycle edits; each is its own commit. */
export const MAXIMUM_REVERSE_HEADER_DOCUMENTS_PER_CYCLE = 8;

async function head(root: string): Promise<string | null> {
  return execute("git", ["-C", root, "rev-parse", "HEAD"]).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );
}

/**
 * Whether HEAD moved past `revision` only through Lervo's own knowledge commits, such as this
 * cycle's freshness applies. Then the web is behind only because of them and the next cycle
 * continues; any other change waits for the observation that the change itself reopens.
 */
async function onlyLervoCommitsSince(root: string, revision: string): Promise<boolean> {
  const authors = await execute("git", [
    "-C",
    root,
    "log",
    "--format=%ae",
    "--max-count=64",
    `${revision}..HEAD`,
  ]).then(
    ({ stdout }) => stdout.split("\n").filter((line) => line !== ""),
    () => null,
  );
  return (
    authors !== null &&
    authors.length > 0 &&
    authors.length < 64 &&
    authors.every((email) => email === KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email)
  );
}

function declarationKey(path: string, declaration: ReverseHeaderDeclaration): string {
  return [path, declaration.kind, declaration.by, declaration.part ?? ""].join("\u0000");
}

/**
 * Reverse lines an earlier candidate already settles: every line of a candidate that was not
 * reverted, and the lines of a reverted one while its hold lasts. A reverted line is therefore not
 * written again during the hold, even when a later declaration gives the record another line, and
 * after the hold it may be written again, as any reverted freshness edit may be regenerated.
 */
function proposedLines(
  candidates: readonly DocumentFreshnessCandidateV1[],
  holds: readonly DocumentFreshnessHold[],
  now: Date,
): Set<string> {
  const held = new Set(
    holds.filter((hold) => Date.parse(hold.until) > now.getTime()).map((hold) => hold.candidateId),
  );
  const keys = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.state === "reverted" && !held.has(candidate.candidateId)) continue;
    for (const declaration of candidate.mechanical?.declarations ?? [])
      keys.add(declarationKey(candidate.documentPath, declaration));
  }
  return keys;
}

/** The committed bytes of a path, only when nobody holds an uncommitted edit of it. */
async function settledBytes(root: string, path: string): Promise<Buffer | null> {
  const [working, committed] = await Promise.all([
    workingBytes(root, path),
    committedBlob(root, path),
  ]);
  return working !== null && committed !== null && working.equals(committed) ? committed : null;
}

/**
 * ADR-0631: writes the reverse header lines decision records lack, through the freshness apply
 * path, with no provider call and no share of the freshness budget. It reads the relation web the
 * observation stored, and only when that web describes HEAD; a web behind only Lervo's own
 * knowledge commits reports `remaining`, so the next cycle observes again and continues.
 *
 * A record qualifies inside the delegation's canonical roots when it and every record declaring
 * its lines have committed bytes that nobody is editing, since the web reads working bytes. A line
 * an earlier candidate settles is not proposed again. Nothing is written unless this host may
 * commit knowledge outputs now, and a write whose commit did not land ends the cycle. Each record
 * is one verified candidate, applied and committed at once, at most `maximumDocuments` per cycle.
 */
export async function applyReverseHeaderEdits(input: {
  context: { storage: FreshnessStorage; now(): Date };
  policy: DocumentFreshnessPolicy;
  /** Preparation inside a convergence batch cannot commit, so it writes nothing. */
  effects?: "prepare" | "apply" | undefined;
  maximumDocuments?: number;
}): Promise<{ appliedCount: number; remaining: boolean }> {
  const none = { appliedCount: 0, remaining: false };
  if (input.effects === "prepare") return none;
  const { storage } = input.context;
  const root = storage.paths.repositoryRoot;
  const web = readRelationWebStore(resolve(root, RELATION_WEB_STATE_PATH));
  if (web === null || web.observedRevision === null) return none;
  if (web.observedRevision !== (await head(root)))
    return {
      appliedCount: 0,
      remaining: await onlyLervoCommitsSince(root, web.observedRevision),
    };
  const delegation = await loadConvergenceDelegation(root).catch(() => null);
  const roots = delegation?.delegation.canonicalRoots ?? [];
  if (delegation === null || delegation.delegation.state !== "active" || roots.length === 0)
    return none;
  const proposed = proposedLines(
    await listFreshnessCandidates(root),
    await listFreshnessHolds(root),
    input.context.now(),
  );
  const ownershipOf = await documentFreshnessOwnershipResolver(root);
  const oracle = filesystemDocumentFreshnessOracle(root);
  const limit = input.maximumDocuments ?? MAXIMUM_REVERSE_HEADER_DOCUMENTS_PER_CYCLE;
  let attempts = 0;
  let appliedCount = 0;
  for (const document of [...web.documents.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    if (!pathWithinConvergenceRoots(document.path, roots)) continue;
    const declarations = reverseHeaderDeclarations(web, document).filter(
      (declaration) => !proposed.has(declarationKey(document.path, declaration)),
    );
    if (declarations.length === 0) continue;
    if (attempts >= limit) return { appliedCount, remaining: true };
    // Uncommitted edits belong to whoever is editing; the record waits until they settle.
    const source = await settledBytes(root, document.path);
    if (source === null) continue;
    const declaringHashes: Record<string, string> = {};
    for (const declaration of declarations) {
      const bytes = await settledBytes(root, declaration.by);
      if (bytes !== null) declaringHashes[declaration.by] = sha256(bytes);
    }
    if (declarations.some((declaration) => declaringHashes[declaration.by] === undefined)) continue;
    if (
      !(await knowledgeOutputCommitSafe(root)) ||
      !(await knowledgeOutputCommitGrant(root)).allowed
    )
      return { appliedCount, remaining: false };
    const now = input.context.now().toISOString();
    const candidate = reverseHeaderCandidate({
      documentPath: document.path,
      adr: document.adr!,
      source: new Uint8Array(source),
      declarations,
      declaringHashes,
      documentOwnership: ownershipOf(document.path),
      policy: input.policy,
      oracle,
      detectedAt: now,
      now,
    });
    if (candidate === null) continue;
    attempts += 1;
    await writeFreshnessCandidate(root, candidate);
    recordFreshnessCandidateOutcome({
      storage,
      candidate,
      documentHash: candidate.sourceHash,
      occurredAt: now,
    });
    const applied = await applyVerifiedFreshness(input.context, candidate).catch(() => candidate);
    if (applied.commitHash !== null) appliedCount += 1;
    // A write whose commit did not land stays as the candidate records it; nothing more is written.
    else if (applied.state === "applied") return { appliedCount, remaining: false };
  }
  return { appliedCount, remaining: false };
}
