import type { VerificationResult, VerificationSuite } from "@lervo/schemas";
import {
  calculateVerificationId,
  verificationCommandDigest,
  verificationResultBytes,
  verificationSuiteHash,
} from "@lervo/verification-contract";
import { describe, expect, it } from "vitest";

import { runManagedProjectVerifications, type ManagedProjectVerification } from "../src/index.js";
import type { ManagedEventSpec } from "../src/telemetry.js";
import { MemoryArtifactStore } from "./fixture.js";

const repositoryRevision = `sha256:${"a".repeat(64)}`;
const suite: VerificationSuite = {
  schemaVersion: 1,
  suiteId: "project.default",
  stopOnFailure: true,
  commands: [
    {
      commandId: "typecheck",
      executable: "node",
      arguments: ["--version"],
      cwd: ".",
      timeoutMs: 1_000,
      maxOutputBytes: 4_096,
      environmentVariableNames: [],
    },
  ],
};

async function createVerification(
  artifacts: MemoryArtifactStore,
): Promise<ManagedProjectVerification> {
  const output = await artifacts.put(new Uint8Array());
  const outputArtifact = {
    artifactId: `art_${output.contentHash.slice(7)}`,
    ...output,
  };
  const resultWithoutId: Omit<VerificationResult, "verificationId"> = {
    schemaVersion: 1,
    suiteId: suite.suiteId,
    suiteHash: verificationSuiteHash(suite),
    repositoryRevision,
    startedAt: "2026-08-19T01:00:00.000Z",
    completedAt: "2026-08-19T01:00:01.000Z",
    status: "passed",
    commands: [
      {
        commandId: "typecheck",
        commandDigest: verificationCommandDigest(suite.commands[0]!),
        status: "passed",
        exitCode: 0,
        startedAt: "2026-08-19T01:00:00.000Z",
        completedAt: "2026-08-19T01:00:01.000Z",
        durationMs: 1_000,
        stdoutArtifact: outputArtifact,
        stderrArtifact: outputArtifact,
        failureCode: null,
      },
    ],
  };
  const result: VerificationResult = {
    ...resultWithoutId,
    verificationId: calculateVerificationId(resultWithoutId),
  };
  const stored = await artifacts.put(verificationResultBytes(result));
  return {
    result,
    resultArtifact: {
      artifactId: `art_${stored.contentHash.slice(7)}`,
      mediaType: "application/vnd.lervo.verification-result+json; charset=utf-8",
      ...stored,
    },
  };
}

describe("managed project verification boundary", () => {
  it("records only validated result coordinates", async () => {
    const artifacts = new MemoryArtifactStore();
    const verification = await createVerification(artifacts);
    const events: ManagedEventSpec[] = [];
    const producedArtifact = {
      artifactId: `art_${"b".repeat(64)}`,
      uri: `lervo-cas://sha256/${"b".repeat(64)}`,
      contentHash: `sha256:${"b".repeat(64)}`,
      byteCount: 42,
      mediaType: "text/markdown; charset=utf-8" as const,
    };

    const results = await runManagedProjectVerifications({
      suites: [suite],
      producedArtifact,
      verifier: {
        verify: async (request) => {
          expect(request.producedArtifact).toEqual(producedArtifact);
          expect(request.producedArtifact).not.toBe(producedArtifact);
          return verification;
        },
      },
      repositoryRoot: "/fixture",
      repositoryRevision,
      artifactStore: artifacts,
      time: () => "2026-08-19T01:00:00.000Z",
      append: (specs) => events.push(...specs),
    });

    expect(results).toEqual([verification]);
    expect(events.map((event) => event.type)).toEqual([
      "verification.started",
      "verification.completed",
    ]);
    expect(JSON.stringify(events)).not.toContain("--version");
  });

  it("rejects a result artifact whose declared size does not match CAS bytes", async () => {
    const artifacts = new MemoryArtifactStore();
    const verification = await createVerification(artifacts);
    const tampered = {
      ...verification,
      resultArtifact: {
        ...verification.resultArtifact,
        byteCount: verification.resultArtifact.byteCount + 1,
      },
    };

    await expect(
      runManagedProjectVerifications({
        suites: [suite],
        verifier: { verify: async () => tampered },
        repositoryRoot: "/fixture",
        repositoryRevision,
        artifactStore: artifacts,
        time: () => "2026-08-19T01:00:00.000Z",
        append: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "verification_failed" });
  });

  it("rejects a result whose referenced command output is missing from CAS", async () => {
    const artifacts = new MemoryArtifactStore();
    const verification = await createVerification(artifacts);
    const outputUri = verification.result.commands[0]!.stdoutArtifact!.uri;
    artifacts.objects.delete(outputUri);

    await expect(
      runManagedProjectVerifications({
        suites: [suite],
        verifier: { verify: async () => verification },
        repositoryRoot: "/fixture",
        repositoryRevision,
        artifactStore: artifacts,
        time: () => "2026-08-19T01:00:00.000Z",
        append: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "verification_failed" });
  });
});
