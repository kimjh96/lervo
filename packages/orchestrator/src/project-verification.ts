import type { ContextArtifactPort } from "@lervo/context-delivery";
import type { VerificationResult, VerificationSuite } from "@lervo/schemas";
import {
  validateVerificationResult,
  verificationResultBytes,
  verificationSha256,
} from "@lervo/verification-contract";

import { verificationCompletedSpec, verificationStartedSpec } from "./provider-run-events.js";
import {
  ManagedProviderRunError,
  type ManagedProjectVerification,
  type ManagedProjectVerifier,
  type ManagedProviderResultArtifact,
} from "./provider-run-types.js";
import type { ManagedEventSpec } from "./telemetry.js";

type VerificationOutputArtifact = NonNullable<
  VerificationResult["commands"][number]["stdoutArtifact"]
>;

export interface RunManagedProjectVerificationsInput {
  suites: readonly VerificationSuite[];
  verifier: ManagedProjectVerifier;
  repositoryRoot: string;
  repositoryRevision: string;
  producedArtifact?: ManagedProviderResultArtifact;
  artifactStore: ContextArtifactPort;
  signal?: AbortSignal;
  time: () => string;
  append: (specs: ManagedEventSpec[]) => void;
}

async function validateVerificationOriginal(input: {
  verification: ManagedProjectVerification;
  suite: VerificationSuite;
  repositoryRevision: string;
  artifactStore: ContextArtifactPort;
}): Promise<void> {
  validateVerificationResult(input.verification.result, input.suite);
  const { result, resultArtifact } = input.verification;
  const outputArtifacts = result.commands.flatMap((command) =>
    [command.stdoutArtifact, command.stderrArtifact].filter(
      (artifact): artifact is VerificationOutputArtifact => artifact !== null,
    ),
  );
  await validateOutputOriginals(outputArtifacts, input.artifactStore);
  let bytes: Uint8Array;
  try {
    bytes = await input.artifactStore.get(resultArtifact.uri);
  } catch (error) {
    throw new ManagedProviderRunError(
      "verification_failed",
      "Could not read the project verification result CAS source.",
      { cause: error },
    );
  }
  if (
    result.repositoryRevision !== input.repositoryRevision ||
    resultArtifact.mediaType !== "application/vnd.lervo.verification-result+json; charset=utf-8" ||
    resultArtifact.contentHash !== verificationSha256(bytes) ||
    resultArtifact.artifactId !== `art_${resultArtifact.contentHash.slice(7)}` ||
    resultArtifact.uri !== `lervo-cas://sha256/${resultArtifact.contentHash.slice(7)}` ||
    resultArtifact.byteCount !== bytes.byteLength ||
    !Buffer.from(verificationResultBytes(result)).equals(Buffer.from(bytes))
  ) {
    throw new ManagedProviderRunError(
      "verification_failed",
      "The project verification result revision, schema, or CAS coordinates differ.",
    );
  }
}

async function validateOutputOriginals(
  artifacts: readonly VerificationOutputArtifact[],
  artifactStore: ContextArtifactPort,
): Promise<void> {
  const uniqueArtifacts = new Map(artifacts.map((artifact) => [artifact.uri, artifact]));
  for (const artifact of uniqueArtifacts.values()) {
    let bytes: Uint8Array;
    try {
      bytes = await artifactStore.get(artifact.uri);
    } catch (error) {
      throw new ManagedProviderRunError(
        "verification_failed",
        "Could not read the project verification output CAS source.",
        { cause: error },
      );
    }
    if (
      artifact.contentHash !== verificationSha256(bytes) ||
      artifact.artifactId !== `art_${artifact.contentHash.slice(7)}` ||
      artifact.uri !== `lervo-cas://sha256/${artifact.contentHash.slice(7)}` ||
      artifact.byteCount !== bytes.byteLength
    ) {
      throw new ManagedProviderRunError(
        "verification_failed",
        "The project verification output CAS coordinates differ from the source.",
      );
    }
  }
}

export async function runManagedProjectVerifications(
  input: RunManagedProjectVerificationsInput,
): Promise<ManagedProjectVerification[]> {
  const results: ManagedProjectVerification[] = [];
  for (const suite of input.suites) {
    input.append([
      verificationStartedSpec({
        suite,
        repositoryRevision: input.repositoryRevision,
        occurredAt: input.time(),
      }),
    ]);
    const verification = await input.verifier.verify({
      suite: structuredClone(suite),
      repositoryRoot: input.repositoryRoot,
      repositoryRevision: input.repositoryRevision,
      ...(input.producedArtifact === undefined
        ? {}
        : { producedArtifact: structuredClone(input.producedArtifact) }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    await validateVerificationOriginal({
      verification,
      suite,
      repositoryRevision: input.repositoryRevision,
      artifactStore: input.artifactStore,
    });
    input.append([
      verificationCompletedSpec({
        result: verification.result,
        resultArtifactId: verification.resultArtifact.artifactId,
        resultContentHash: verification.resultArtifact.contentHash,
      }),
    ]);
    results.push(structuredClone(verification));
    if (verification.result.status === "cancelled") break;
  }
  return results;
}

export async function runRequiredProjectVerifications(
  input: RunManagedProjectVerificationsInput & {
    failureDisposition: "fail_run" | "require_review";
  },
): Promise<ManagedProjectVerification[]> {
  const verifications = await runManagedProjectVerifications(input);
  if (verifications.some((item) => item.result.status === "cancelled")) {
    throw new ManagedProviderRunError("cancelled", "Project verification was cancelled.");
  }
  const failed =
    verifications.length !== input.suites.length ||
    verifications.some((item) => item.result.status !== "passed");
  if (failed && input.failureDisposition === "fail_run") {
    const failedSuiteIds = verifications
      .filter((item) => item.result.status !== "passed")
      .map((item) => item.result.suiteId);
    throw new ManagedProviderRunError(
      "verification_failed",
      `Required project verification did not pass: ${failedSuiteIds.join(", ")}`,
    );
  }
  return verifications;
}
