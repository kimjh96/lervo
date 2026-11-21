import { reviewReferences } from "@lervo/repository-knowledge";

/**
 * ADR-0608: a model asked to copy a hash back garbles some, so the owner decision never returns
 * one. Where the owner chooses among several hashes, the prompt shows each with a short reference
 * and the decision cites the reference. Both sets derive only from canonical facts, so the parser
 * rebuilds the same references the prompt showed.
 */
export interface OwnerReferenceFacts {
  handoffs: { pendingIncoming: readonly string[] };
  tasks: { assignments: readonly { artifactHashes: readonly string[] }[] };
}

/** ADR-0608: the pending incoming handoffs the owner may accept, cited as `h1`, `h2`, … */
export function ownerHandoffReferences(facts: OwnerReferenceFacts) {
  return reviewReferences(facts.handoffs.pendingIncoming, { prefix: "h" });
}

/**
 * ADR-0608: the returned result artifacts a handoff request may cite as evidence, as `e1`, `e2`, …
 * They are the same sorted hashes as the context `results` the owner reads.
 */
export function ownerEvidenceReferences(facts: OwnerReferenceFacts) {
  const hashes = [
    ...new Set(facts.tasks.assignments.flatMap((assignment) => assignment.artifactHashes)),
  ].sort();
  return reviewReferences(hashes, { prefix: "e" });
}

/**
 * ADR-0608: maps the references an owner decision cites back to the exact hashes the native
 * effects bind. Returns null when the decision names an unknown reference or carries a hash
 * itself; the caller refuses it like any other invalid proposal. Other details pass unchanged.
 */
export function bindOwnerDecisionReferences(
  operation: string,
  details: Record<string, unknown>,
  facts: OwnerReferenceFacts,
): Record<string, unknown> | null {
  if (operation === "accept_team_support") {
    if (Object.keys(details).join(",") !== "handoffReference") return null;
    const handoffHash = ownerHandoffReferences(facts).resolve(details.handoffReference);
    return handoffHash === undefined ? null : { handoffHash };
  }
  if (operation !== "request_team_support" && operation !== "escalate") return details;
  if (!Object.hasOwn(details, "request")) return details;
  const request = details.request;
  if (request === null || typeof request !== "object" || Array.isArray(request)) return details;
  const { evidenceReferences, ...rest } = request as Record<string, unknown>;
  if (Object.hasOwn(rest, "evidenceArtifactHashes") || !Array.isArray(evidenceReferences))
    return null;
  const evidence = ownerEvidenceReferences(facts);
  const evidenceArtifactHashes = evidenceReferences.map((reference) => evidence.resolve(reference));
  if (evidenceArtifactHashes.some((hash) => hash === undefined)) return null;
  return { ...details, request: { ...rest, evidenceArtifactHashes } };
}

/**
 * ADR-0608: true when a recorded decision has exactly `keys` (sorted, comma-joined), so Lervo bound
 * its result hash itself. A decision recorded before this change also carries `resultContentHash`;
 * it stays valid only when that hash equals the bound one.
 */
export function boundResultDetails(
  details: Record<string, unknown>,
  keys: string,
  resultHash: string,
): boolean {
  const { resultContentHash, ...rest } = details;
  return (
    Object.keys(rest).sort().join(",") === keys &&
    (!Object.hasOwn(details, "resultContentHash") || resultContentHash === resultHash)
  );
}
