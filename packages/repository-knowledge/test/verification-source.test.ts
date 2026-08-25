import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { EventEnvelope, VerificationResult, VerificationSuite } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  calculateVerificationId,
  verificationCommandDigest,
  verificationResultBytes,
  verificationSha256,
  verificationSuiteHash,
} from "@lervo/verification-contract";
import { afterEach, describe, expect, it } from "vitest";

import { defaultRepositoryKnowledgePolicy } from "../src/policy.js";
import { scanRepositoryKnowledge } from "../src/scanner.js";
import { collectVerificationResultSources } from "../src/verification-source.js";

const roots: string[] = [];

function fixture(): {
  suite: VerificationSuite;
  result: VerificationResult;
  bytes: Uint8Array;
  event: EventEnvelope;
} {
  const suite: VerificationSuite = {
    schemaVersion: 1,
    suiteId: "project.check",
    stopOnFailure: true,
    commands: [
      {
        commandId: "tests",
        executable: "node",
        arguments: ["--test"],
        cwd: ".",
        timeoutMs: 5_000,
        maxOutputBytes: 1024 * 1024,
        environmentVariableNames: [],
      },
    ],
  };
  const content: Omit<VerificationResult, "verificationId"> = {
    schemaVersion: 1,
    suiteId: suite.suiteId,
    suiteHash: verificationSuiteHash(suite),
    repositoryRevision: `sha256:${"a".repeat(64)}`,
    startedAt: "2026-08-23T00:00:00.000Z",
    completedAt: "2026-08-23T00:00:01.000Z",
    status: "passed",
    commands: [
      {
        commandId: "tests",
        commandDigest: verificationCommandDigest(suite.commands[0]!),
        status: "passed",
        exitCode: 0,
        startedAt: "2026-08-23T00:00:00.000Z",
        completedAt: "2026-08-23T00:00:01.000Z",
        durationMs: 1_000,
        stdoutArtifact: {
          artifactId: `art_${verificationSha256(new Uint8Array()).slice("sha256:".length)}`,
          uri: `lervo-cas://sha256/${verificationSha256(new Uint8Array()).slice("sha256:".length)}`,
          contentHash: verificationSha256(new Uint8Array()),
          byteCount: 0,
        },
        stderrArtifact: {
          artifactId: `art_${verificationSha256(new Uint8Array()).slice("sha256:".length)}`,
          uri: `lervo-cas://sha256/${verificationSha256(new Uint8Array()).slice("sha256:".length)}`,
          contentHash: verificationSha256(new Uint8Array()),
          byteCount: 0,
        },
        failureCode: null,
      },
    ],
  };
  const result: VerificationResult = {
    ...content,
    verificationId: calculateVerificationId(content),
  };
  const bytes = verificationResultBytes(result);
  const resultContentHash = verificationSha256(bytes);
  const event = {
    seq: 1,
    type: "verification.completed",
    occurredAt: result.completedAt,
    payload: {
      verificationId: result.verificationId,
      suiteId: result.suiteId,
      suiteHash: result.suiteHash,
      repositoryRevision: result.repositoryRevision,
      status: result.status,
      resultArtifactId: `art_${resultContentHash.slice("sha256:".length)}`,
      resultContentHash,
      nonPassedCommandIds: [],
    },
  } as unknown as EventEnvelope;
  return { suite, result, bytes, event };
}

function ports(
  event: EventEnvelope,
  bytes: Uint8Array,
): {
  events: Pick<EventStore, "latest" | "list" | "verifyIntegrity">;
  artifacts: Pick<ArtifactStore, "get">;
} {
  return {
    events: {
      latest: () => event,
      list: (options) =>
        event.seq > (options?.afterSeq ?? 0) ? [event].slice(0, options?.limit) : [],
      verifyIntegrity: () => ({
        valid: true,
        eventCount: 1,
        headHash: event.eventHash ?? `sha256:${"b".repeat(64)}`,
      }),
    },
    artifacts: { get: async () => bytes },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verification result knowledge source", () => {
  it("binds a canonical completed event and CAS original as one supplemental unit", async () => {
    const { suite, result, bytes, event } = fixture();
    const sources = await collectVerificationResultSources({
      ...ports(event, bytes),
      loadSuite: async () => suite,
    });
    expect(sources).toEqual([
      expect.objectContaining({
        path: `@verification/${result.verificationId}`,
        kind: "verification_result",
        origin: "verification_event_cas",
        unitKind: "verification",
        locator: `verification:${result.verificationId}`,
      }),
    ]);

    const root = await mkdtemp(resolve(tmpdir(), "lervo-verification-source-"));
    roots.push(root);
    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: "prj_verificationsource",
      policy: defaultRepositoryKnowledgePolicy,
      supplementalSources: sources,
      observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
    });
    const source = scan.sources.find((item) => item.path === sources[0]!.path)!;
    const unit = scan.units.find((item) => item.path === sources[0]!.path)!;
    expect(source).toMatchObject({ status: "included", byteCount: bytes.byteLength });
    expect(unit).toMatchObject({
      unitKind: "verification",
      range: { startByte: 0, endByte: bytes.byteLength },
    });
    expect(scan.snapshotId).not.toBe(scan.contentSnapshotId);
  });

  it("fails closed on a changed CAS original without exposing its bytes", async () => {
    const { suite, bytes, event } = fixture();
    const privateBytes = Buffer.concat([
      Buffer.from(bytes),
      Buffer.from("private-verification-fixture"),
    ]);
    const result = collectVerificationResultSources({
      ...ports(event, privateBytes),
      loadSuite: async () => suite,
    });
    await expect(result).rejects.toMatchObject({ code: "knowledge_evidence_source_invalid" });
    await expect(result).rejects.not.toThrow(/private-verification-fixture|project\.check/);
  });
});
