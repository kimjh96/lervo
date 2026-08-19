import {
  access,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import type { ArtifactStore } from "@lervo/storage-contract";
import { stringify } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  calculateVerificationId,
  loadVerificationSuite,
  runVerificationSuite,
  validateVerificationResult,
  verificationResultJson,
  verificationSuiteHash,
} from "../src/index.js";
import {
  command,
  removeTemporaryRepositories,
  REPOSITORY_REVISION,
  stableRepositoryRevision,
  suite,
  temporaryRepository,
} from "./verification-fixture.js";

afterEach(removeTemporaryRepositories);

async function artifactText(store: ArtifactStore, uri: string): Promise<string> {
  return new TextDecoder().decode(await store.get(uri));
}

describe("project verification", () => {
  it("loads one sharded suite without following a suite file symlink", async () => {
    const { root } = await temporaryRepository();
    const definition = suite([command("unit-tests", "process.exit(0)")]);
    await writeFile(
      resolve(root, ".lervo/verifications/project.check.yaml"),
      stringify(definition),
      "utf8",
    );

    await expect(loadVerificationSuite(root, "project.check")).resolves.toEqual(definition);

    const outside = resolve(root, "outside.yaml");
    await writeFile(outside, stringify(definition), "utf8");
    await writeFile(
      resolve(root, ".lervo/verifications/other.check.yaml"),
      stringify({ ...definition, suiteId: "other.check" }),
      "utf8",
    );
    await symlink(outside, resolve(root, ".lervo/verifications/linked.check.yaml"));
    await expect(loadVerificationSuite(root, "linked.check")).rejects.toMatchObject({
      code: "verification_layout_invalid",
    });
  });

  it("executes shell-free commands and stores stdout, stderr, and result bytes in CAS", async () => {
    const { root, artifacts } = await temporaryRepository();
    const definition = suite([
      command(
        "unit-tests",
        'process.stdout.write("useful output"); process.stderr.write("warning output")',
      ),
      command("typecheck", "process.exit(0)"),
    ]);

    const execution = await runVerificationSuite({
      suite: definition,
      repositoryRoot: root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: stableRepositoryRevision,
      artifactStore: artifacts,
    });

    expect(execution.result.status).toBe("passed");
    expect(execution.result.commands.map((item) => item.status)).toEqual(["passed", "passed"]);
    expect(execution.result.suiteHash).toBe(verificationSuiteHash(definition));
    expect(calculateVerificationId(execution.result)).toBe(execution.result.verificationId);
    const first = execution.result.commands[0]!;
    expect(await artifactText(artifacts, first.stdoutArtifact!.uri)).toBe("useful output");
    expect(await artifactText(artifacts, first.stderrArtifact!.uri)).toBe("warning output");
    expect(JSON.parse(await artifactText(artifacts, execution.resultArtifact.uri)))
      .toEqual(execution.result);
    expect(execution.resultArtifact.mediaType)
      .toBe("application/vnd.lervo.verification-result+json; charset=utf-8");
  });

  it("keeps command text and output out of result metadata", async () => {
    const { root, artifacts } = await temporaryRepository();
    const definition = suite([
      command("privacy", 'process.stdout.write("raw-secret-output")'),
    ]);

    const execution = await runVerificationSuite({
      suite: definition,
      repositoryRoot: root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: stableRepositoryRevision,
      artifactStore: artifacts,
    });
    const metadata = verificationResultJson(execution.result);

    expect(metadata).not.toContain("raw-secret-output");
    expect(metadata).not.toContain("process.stdout.write");
    expect(metadata).toContain(execution.result.commands[0]!.commandDigest);
  });

  it("cannot mark a failed command passed and does not run dependent commands", async () => {
    const { root, artifacts } = await temporaryRepository();
    const marker = resolve(root, "must-not-exist.txt");
    const definition = suite([
      command("unit-tests", 'process.stderr.write("failed"); process.exit(3)'),
      command("build", 'require("node:fs").writeFileSync("must-not-exist.txt", "bad")'),
    ]);

    const execution = await runVerificationSuite({
      suite: definition,
      repositoryRoot: root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: stableRepositoryRevision,
      artifactStore: artifacts,
    });

    expect(execution.result.status).toBe("failed");
    expect(execution.result.commands[0]).toMatchObject({
      status: "failed",
      exitCode: 3,
      failureCode: "nonzero_exit",
    });
    expect(execution.result.commands[1]).toMatchObject({
      status: "not_run",
      startedAt: null,
      stdoutArtifact: null,
      failureCode: "blocked_by_previous_failure",
    });
    await expect(access(marker)).rejects.toThrow();

    const forged = structuredClone(execution.result);
    forged.status = "passed";
    expect(() => validateVerificationResult(forged, definition)).toThrowError(
      expect.objectContaining({ code: "result_contract_invalid" }),
    );
  });

  it("fails closed on timeout and bounded output instead of losing evidence silently", async () => {
    const timed = await temporaryRepository();
    const timedResult = await runVerificationSuite({
      suite: suite([command("timeout", "setInterval(() => {}, 1000)", { timeoutMs: 100 })]),
      repositoryRoot: timed.root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: stableRepositoryRevision,
      artifactStore: timed.artifacts,
    });
    expect(timedResult.result).toMatchObject({
      status: "failed",
      commands: [{ status: "timed_out", failureCode: "timeout" }],
    });

    const noisy = await temporaryRepository();
    const noisyResult = await runVerificationSuite({
      suite: suite([
        command("noisy", 'process.stdout.write("x".repeat(2048))', { maxOutputBytes: 1024 }),
      ]),
      repositoryRoot: noisy.root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: stableRepositoryRevision,
      artifactStore: noisy.artifacts,
    });
    expect(noisyResult.result).toMatchObject({
      status: "failed",
      commands: [{
        status: "output_limit_exceeded",
        failureCode: "output_limit_exceeded",
        stdoutArtifact: { byteCount: 1024 },
      }],
    });
  });

  it("records a pre-execution cancellation without pretending commands ran", async () => {
    const { root, artifacts } = await temporaryRepository();
    const controller = new AbortController();
    controller.abort();
    const execution = await runVerificationSuite({
      suite: suite([command("unit-tests", "process.exit(0)")]),
      repositoryRoot: root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: stableRepositoryRevision,
      artifactStore: artifacts,
      signal: controller.signal,
    });

    expect(execution.result.status).toBe("cancelled");
    expect(execution.result.commands[0]).toMatchObject({
      status: "not_run",
      startedAt: null,
      failureCode: "cancelled",
    });
  });

  it("requires the requested repository snapshot before and after command execution", async () => {
    const beforeMismatch = await temporaryRepository();
    const marker = resolve(beforeMismatch.root, "must-not-run.txt");
    await expect(runVerificationSuite({
      suite: suite([
        command("unit-tests", 'require("node:fs").writeFileSync("must-not-run.txt", "bad")'),
      ]),
      repositoryRoot: beforeMismatch.root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: async () => `sha256:${"b".repeat(64)}`,
      artifactStore: beforeMismatch.artifacts,
    })).rejects.toMatchObject({ code: "repository_snapshot_mismatch" });
    await expect(access(marker)).rejects.toThrow();

    const changed = await temporaryRepository();
    const revisions = [REPOSITORY_REVISION, `sha256:${"c".repeat(64)}`];
    await expect(runVerificationSuite({
      suite: suite([command("unit-tests", "process.exit(0)")]),
      repositoryRoot: changed.root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: async () => revisions.shift()!,
      artifactStore: changed.artifacts,
    })).rejects.toMatchObject({ code: "repository_changed_during_verification" });
  });

  it("rejects duplicate commands and a symlinked working directory before execution", async () => {
    const { root, artifacts } = await temporaryRepository();
    const duplicate = command("same", "process.exit(0)");
    await expect(runVerificationSuite({
      suite: suite([duplicate, duplicate]),
      repositoryRoot: root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: stableRepositoryRevision,
      artifactStore: artifacts,
    })).rejects.toMatchObject({ code: "invalid_verification_suite" });

    const outside = resolve(root, "outside");
    await mkdir(outside);
    await symlink(outside, resolve(root, "linked"));
    await expect(runVerificationSuite({
      suite: suite([command("linked", "process.exit(0)", { cwd: "linked" })]),
      repositoryRoot: root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: stableRepositoryRevision,
      artifactStore: artifacts,
    })).rejects.toMatchObject({ code: "command_working_directory_invalid" });
  });

  it("does not return a verification result when CAS read-back verification fails", async () => {
    const { root } = await temporaryRepository();
    const brokenStore: ArtifactStore = {
      async put(content) {
        const byteCount = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
        return {
          uri: `lervo-cas://sha256/${"b".repeat(64)}`,
          contentHash: `sha256:${"b".repeat(64)}`,
          byteCount,
          created: true,
        };
      },
      async putStream() {
        throw new Error("unused");
      },
      async get() {
        return new Uint8Array();
      },
      async has() {
        return false;
      },
    };

    await expect(runVerificationSuite({
      suite: suite([command("unit-tests", "process.exit(0)")]),
      repositoryRoot: root,
      repositoryRevision: REPOSITORY_REVISION,
      captureRepositoryRevision: stableRepositoryRevision,
      artifactStore: brokenStore,
    })).rejects.toMatchObject({ code: "artifact_storage_failed" });
  });
});
