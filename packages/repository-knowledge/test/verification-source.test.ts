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
import {
  collectVerificationResultSources,
  collectVerificationResultSourcesTolerantly,
} from "../src/verification-source.js";

const roots: string[] = [];

function fixture(index = 0): {
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
    repositoryRevision: `sha256:${index.toString(16).padStart(64, "0")}`,
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
    seq: index + 1,
    previousHash: null,
    eventHash: `sha256:${"b".repeat(64)}`,
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
  events: Pick<EventStore, "latest" | "list">;
  artifacts: Pick<ArtifactStore, "get">;
} {
  return {
    events: {
      latest: () => event,
      list: (options) =>
        event.seq > (options?.afterSeq ?? 0) ? [event].slice(0, options?.limit) : [],
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
  it("keeps an earlier result valid after its suite gains a command", async () => {
    const { suite, result, bytes, event } = fixture();
    const extended: VerificationSuite = {
      ...suite,
      commands: [...suite.commands, { ...suite.commands[0]!, commandId: "lint" }],
    };
    const sources = await collectVerificationResultSources({
      ...ports(event, bytes),
      loadSuite: async () => extended,
    });
    expect(sources.map((source) => source.path)).toEqual([
      `@verification/${result.verificationId}`,
    ]);
    // Integrity still binds the recorded bytes even when the suite changed.
    const tampered = verificationResultBytes({ ...result, status: "failed" });
    await expect(
      collectVerificationResultSources({
        ...ports(event, tampered),
        loadSuite: async () => extended,
      }),
    ).rejects.toMatchObject({ code: "knowledge_evidence_source_invalid" });
  });

  it("reads only completions however far the store head is beyond 100,000 events", async () => {
    const { suite, result, bytes, event } = fixture(119_999);
    // ADR-0554: the head is a later event of another type; the typed read never visits it.
    const head = { ...event, seq: 150_000, type: "run.requested" } as EventEnvelope;
    const store = completionStore([event], head);
    const sources = await collectVerificationResultSources({
      events: store,
      artifacts: { get: async () => bytes },
      loadSuite: async () => suite,
    });
    expect(sources.map((source) => source.path)).toEqual([
      `@verification/${result.verificationId}`,
    ]);
    expect(store.calls).toEqual([["verification.completed"]]);
  });

  it("selects the newest results instead of failing and still rejects conflicting completions", async () => {
    const fixtures = Array.from({ length: 258 }, (_, index) => fixture(index));
    const artifacts = new Map(
      fixtures.map(({ bytes }) => [
        `lervo-cas://sha256/${verificationSha256(bytes).slice("sha256:".length)}`,
        bytes,
      ]),
    );
    const input = {
      artifacts: { get: async (uri: string) => artifacts.get(uri)! },
      loadSuite: async () => fixtures[0]!.suite,
    };
    const events = fixtures.map(({ event }) => event);
    const sources = await collectVerificationResultSources({
      ...input,
      events: completionStore(events),
    });
    expect(sources.map((source) => source.path)).toEqual(
      fixtures
        .slice(2)
        .map(({ result }) => `@verification/${result.verificationId}`)
        .sort((left, right) => left.localeCompare(right)),
    );
    // A later identical completion makes the oldest verification recent again.
    const repeated = { ...events[0]!, seq: 259 } as EventEnvelope;
    const reselected = await collectVerificationResultSources({
      ...input,
      events: completionStore([...events, repeated]),
    });
    expect(reselected.map((source) => source.path)).toContain(
      `@verification/${fixtures[0]!.result.verificationId}`,
    );
    expect(reselected).toHaveLength(256);
    // Its earlier completion left the window before the conflicting one arrived.
    const conflicting = {
      ...repeated,
      payload: { ...repeated.payload, status: "failed" },
    } as EventEnvelope;
    for (const history of [
      [...events, conflicting],
      [events[0]!, { ...conflicting, seq: 2 } as EventEnvelope],
    ])
      await expect(
        collectVerificationResultSources({ ...input, events: completionStore(history) }),
      ).rejects.toMatchObject({ code: "knowledge_evidence_source_invalid" });
  });

  it("binds a result whose suite the evidence root lacks to the suite hash it recorded", async () => {
    const { result, bytes, event } = fixture();
    // ADR-0649: the suite exists only on another checkout's branch, or was renamed since.
    const input = { ...ports(event, bytes), loadSuite: async () => null };
    for (const collected of [
      await collectVerificationResultSources(input),
      (await collectVerificationResultSourcesTolerantly(input)).sources,
    ])
      expect(collected.map((source) => source.path)).toEqual([
        `@verification/${result.verificationId}`,
      ]);
    // The event and CAS bindings still hold without the suite.
    const tampered = verificationResultBytes({ ...result, status: "failed" });
    await expect(
      collectVerificationResultSources({ ...ports(event, tampered), loadSuite: async () => null }),
    ).rejects.toMatchObject({ code: "knowledge_evidence_source_invalid" });
  });

  it("leaves out and counts only the results it cannot bind when reading tolerantly", async () => {
    const bound = fixture(0);
    const missingOriginal = fixture(1);
    const changedOriginal = fixture(2);
    const uri = (bytes: Uint8Array) =>
      `lervo-cas://sha256/${verificationSha256(bytes).slice("sha256:".length)}`;
    const artifacts = new Map([
      [uri(bound.bytes), bound.bytes],
      // The stored original of this result no longer matches its recorded hash.
      [uri(changedOriginal.bytes), Buffer.from("private-verification-fixture")],
    ]);
    const input = {
      events: completionStore([bound.event, missingOriginal.event, changedOriginal.event]),
      artifacts: {
        get: async (address: string) => {
          const found = artifacts.get(address);
          if (found !== undefined) return found;
          throw Object.assign(new Error("The artifact was not found."), {
            name: "CasError",
            code: "not_found",
          });
        },
      },
      loadSuite: async () => bound.suite,
    };
    const tolerant = await collectVerificationResultSourcesTolerantly(input);
    expect(tolerant.sources.map((source) => source.path)).toEqual([
      `@verification/${bound.result.verificationId}`,
    ]);
    expect(tolerant.omittedCount).toBe(2);
    expect(JSON.stringify(tolerant)).not.toContain("private-verification-fixture");
    // The corpus collectors keep ADR-0176: any unbindable result fails the whole corpus.
    await expect(collectVerificationResultSources(input)).rejects.toMatchObject({
      code: "knowledge_evidence_source_invalid",
    });
    // An unreadable history is not a per-result omission.
    const conflicting = {
      ...bound.event,
      seq: 4,
      payload: { ...bound.event.payload, status: "failed" },
    } as EventEnvelope;
    await expect(
      collectVerificationResultSourcesTolerantly({
        ...input,
        events: completionStore([bound.event, conflicting]),
      }),
    ).rejects.toMatchObject({ code: "knowledge_evidence_source_invalid" });
  });

  it("lets a busy store or a bug throw as itself when reading tolerantly", async () => {
    const { suite, bytes, event } = fixture();
    const locked = Object.assign(new Error("database is locked"), { code: "ERR_SQLITE_ERROR" });
    const base = { ...ports(event, bytes), loadSuite: async () => suite };
    const throwing = (error: Error) => () => {
      throw error;
    };
    for (const input of [
      { ...base, artifacts: { get: async () => Promise.reject(locked) } },
      { ...base, events: { ...base.events, latest: throwing(locked) } },
      { ...base, events: { ...base.events, list: throwing(locked) } },
      { ...base, loadSuite: async () => Promise.reject(new TypeError("a bug")) },
    ]) {
      const error = await collectVerificationResultSourcesTolerantly(input).catch(
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toMatchObject({ code: "knowledge_evidence_source_invalid" });
      // The corpus collectors still fail closed on the same input.
      await expect(collectVerificationResultSources(input)).rejects.toMatchObject({
        code: "knowledge_evidence_source_invalid",
      });
    }
  });
});

function completionStore(events: EventEnvelope[], head = events.at(-1)!) {
  const calls: (readonly string[] | undefined)[] = [];
  return {
    calls,
    latest: () => head,
    list: (options?: { afterSeq?: number; limit?: number; types?: readonly string[] }) => {
      calls.push(options?.types);
      return events
        .filter((event) => event.seq > (options?.afterSeq ?? 0))
        .filter((event) => options?.types === undefined || options.types.includes(event.type))
        .slice(0, options?.limit);
    },
  };
}
