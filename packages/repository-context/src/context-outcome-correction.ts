import { ContextQualityError, protectedMarkdownDigests, readRepositoryFile } from "@lervo/context";
import { sha256 } from "@lervo/repository-knowledge";
import { resolveArtifactWritingContract } from "@lervo/writing";
import { canonicalHash } from "@lervo/search";
import { applyArtifactCorrectionEdits } from "@lervo/verification";
import { evaluateContextOutcomeBytes } from "./context-outcome-evaluation.js";
import { verifyContextOutcome } from "./context-outcome-verification.js";
import { freezeOutcomeInput, type ContextOutcomeInput } from "./context-outcome-types.js";
import type {
  ContextOutcomeCorrectionPorts,
  ContextOutcomeCorrectionResult,
} from "./context-outcome-correction-types.js";

/** Failed drafts stay in memory; only a fully verified proposal reaches the admitted effect owner. */
export async function correctContextOutcome(
  source: ContextOutcomeInput,
  ports: ContextOutcomeCorrectionPorts,
): Promise<ContextOutcomeCorrectionResult> {
  const input = freezeOutcomeInput(source);
  const editable = structuredClone(ports.editable);
  const maximumAttempts = ports.maximumAttempts;
  const propose = ports.propose.bind(ports);
  const apply = ports.apply.bind(ports);
  if (
    !Number.isInteger(maximumAttempts) ||
    maximumAttempts < 1 ||
    maximumAttempts > 3 ||
    !Number.isInteger(ports.deadlineMs) ||
    ports.deadlineMs < 1 ||
    ports.deadlineMs > 60000
  )
    throw new TypeError(
      "Correction requires one to three attempts and a deadline up to sixty seconds.",
    );
  const signal = AbortSignal.any([
    AbortSignal.timeout(ports.deadlineMs),
    ...(ports.signal ? [ports.signal] : []),
  ]);
  const result: ContextOutcomeCorrectionResult = {
    status: "unavailable",
    reason: "verification_unavailable",
    attempts: 0,
    applied: false,
    observation: null,
    candidateObservations: [],
  };
  const finish = (
    status: ContextOutcomeCorrectionResult["status"],
    reason: ContextOutcomeCorrectionResult["reason"],
  ) => ({ ...result, status, reason });
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    let listener: () => void = () => undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          listener = () => reject(signal.reason);
          signal.addEventListener("abort", listener, { once: true });
          if (signal.aborted) listener();
        }),
      ]);
    } finally {
      signal.removeEventListener("abort", listener);
    }
  };
  try {
    if (!input.definition.task) return finish("unavailable", "no_task_definition");
    const original = await bounded(() =>
      readRepositoryFile(input.repositoryRoot, input.artifactPath, 1048576),
    );
    const beforeDigest = sha256(original);
    if (editable.artifactDigest !== beforeDigest) return finish("unavailable", "scope_stale");
    const assertCurrent = async () => {
      signal.throwIfAborted();
      await input.assertPlanCurrent();
      if (input.definition.languageException)
        await resolveArtifactWritingContract({
          language: input.definition.language,
          planDigest: input.planDigest,
          artifactPath: input.artifactPath,
          definitionId: input.definition.definitionId,
          exception: input.definition.languageException,
          ...(input.authorizeLanguageException
            ? { authorizeException: input.authorizeLanguageException }
            : {}),
        });
      if (
        sha256(await readRepositoryFile(input.repositoryRoot, input.artifactPath, 1048576)) !==
        beforeDigest
      )
        throw new ContextQualityError("context_binding_stale");
      signal.throwIfAborted();
    };
    result.observation = await bounded(() =>
      evaluateContextOutcomeBytes(input, original, assertCurrent),
    );
    if (result.observation.disposition === "passed") return finish("unchanged", "already_passed");
    if (result.observation.disposition === "not_applicable")
      return finish("unchanged", "not_applicable");
    if (result.observation.disposition !== "failed")
      return finish("unavailable", "verification_unavailable");
    for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
      await bounded(assertCurrent);
      result.attempts = attempt;
      const edits = await bounded(() =>
        propose({
          definition: structuredClone(input.definition),
          content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(original),
          artifactDigest: beforeDigest,
          planDigest: input.planDigest,
          verificationDefinitionHash: canonicalHash(input.definition),
          observation: structuredClone(result.candidateObservations.at(-1) ?? result.observation!),
          attempt,
          signal,
        }),
      );
      let candidate: Uint8Array;
      try {
        candidate = applyArtifactCorrectionEdits(original, editable.ranges, edits);
      } catch {
        return finish("rejected", "proposal_invalid");
      }
      if (
        canonicalHash(protectedMarkdownDigests(candidate)) !==
        canonicalHash(protectedMarkdownDigests(original))
      )
        return finish("rejected", "protected_material_changed");
      const observation = await bounded(() =>
        evaluateContextOutcomeBytes(input, candidate, assertCurrent),
      );
      result.candidateObservations.push(observation);
      if (observation.disposition === "unavailable")
        return finish("unavailable", "verification_unavailable");
      if (observation.disposition !== "passed") continue;
      await bounded(assertCurrent);
      // Do not race an in-flight write: its owner must settle its atomic effect before returning.
      result.applied = null;
      const applied = await apply({
        artifactPath: input.artifactPath,
        beforeDigest,
        afterDigest: sha256(candidate),
        bytes: new Uint8Array(candidate),
        planDigest: input.planDigest,
        verificationDefinitionHash: canonicalHash(input.definition),
        signal,
        assertCurrent,
      });
      result.applied = applied === "applied";
      if (applied !== "applied")
        return finish(
          applied === "denied" ? "rejected" : "unavailable",
          applied === "denied" ? "authority_denied" : "artifact_conflict",
        );
      result.applied = true;
      result.observation = null;
      const final = await bounded(() => verifyContextOutcome(input));
      result.observation = final;
      if (final.artifactDigest !== sha256(candidate) || final.disposition !== "passed")
        return finish("unavailable", "final_verification_failed");
      return finish("corrected", "corrected");
    }
    return finish("exhausted", "attempts_exhausted");
  } catch {
    if (signal.aborted)
      return finish("cancelled", ports.signal?.aborted ? "cancelled" : "deadline");
    return finish("unavailable", "effect_unavailable");
  }
}
