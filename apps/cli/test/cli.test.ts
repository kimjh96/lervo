import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";

import { runCli } from "../src/main.js";

const temporaryRoots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("lervo init CLI", () => {
  it("prints the exact creation plan without mutating on dry-run", async () => {
    const root = await temporaryRepository();
    let output = "";
    const exitCode = await runCli(["init", "--dry-run", "--name", "fixture"], {
      cwd: root,
      stdout: (message) => {
        output += message;
      },
      stderr: () => undefined,
    });

    expect(exitCode).toBe(0);
    expect(output).toContain("생성  .lervo/project.yaml");
    expect(output).toContain("+ name: fixture");
    await expect(access(resolve(root, ".lervo"))).rejects.toThrow();
  });

  it("applies init and reports an idempotent second run", async () => {
    const root = await temporaryRepository();
    const messages: string[] = [];
    const io = {
      cwd: root,
      stdout: (message: string) => messages.push(message),
      stderr: (message: string) => messages.push(message),
    };

    expect(await runCli(["init"], io)).toBe(0);
    expect(await runCli(["init"], io)).toBe(0);
    expect(messages.join("")).toContain("Lervo 프로젝트를 초기화했습니다.");
    expect(messages.join("")).toContain("이미 초기화된 프로젝트입니다.");
  });
});

describe("lervo run CLI arguments", () => {
  it("rejects an incomplete run command before opening a managed run", async () => {
    const root = await temporaryRepository();
    let called = false;
    let errorOutput = "";
    const exitCode = await runCli(
      ["run", "--provider", "codex", "작업"],
      {
        cwd: root,
        stdout: () => undefined,
        stderr: (message) => { errorOutput += message; },
      },
      {
        executeManagedRun: async () => {
          called = true;
          throw new Error("must not run");
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    expect(errorOutput).toContain("provider, path와 작업 문장이 필요합니다");
  });
});

describe("lervo local diagnostics CLI", () => {
  it("traces the latest run from append-only local events", async () => {
    const root = await temporaryRepository();
    expect(await runCli(["init"], {
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
    })).toBe(0);
    const storage = await openProjectStorage(root);
    const common = {
      projectId: storage.manifest.projectId,
      runId: "run_cli_trace_0001",
      sessionId: "ses_cli_trace_0001",
      actor: { kind: "system" as const },
      schemaVersion: 1 as const,
      policyVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    };
    storage.events.append({
      ...common,
      eventId: "evt_cli_trace_start",
      type: "run.requested",
      occurredAt: "2026-08-19T00:00:00Z",
      payload: {
        requestDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        role: "developer",
        risk: "low",
      },
    });
    storage.events.append({
      ...common,
      eventId: "evt_cli_trace_done",
      type: "run.completed",
      occurredAt: "2026-08-19T00:00:01Z",
      payload: {
        resultDigest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        artifactIds: [],
        verificationStatus: "not_run",
      },
    });
    await storage.close();

    let output = "";
    const code = await runCli(["trace", "last"], {
      cwd: root,
      stdout: (message) => { output += message; },
      stderr: () => undefined,
    });

    expect(code).toBe(0);
    expect(output).toContain("실행 추적 결과: run_cli_trace_0001");
    expect(output).toContain("run.requested");
    expect(output).toContain("run.completed");
    expect(output).not.toContain("원문 주장");
  });

  it("reports healthy storage and fails closed on a broken candidate reference", async () => {
    const root = await temporaryRepository();
    expect(await runCli(["init"], {
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
    })).toBe(0);
    let healthyOutput = "";
    expect(await runCli(["doctor"], {
      cwd: root,
      stdout: (message) => { healthyOutput += message; },
      stderr: () => undefined,
    })).toBe(0);
    expect(healthyOutput).toContain("문제 없음");

    const storage = await openProjectStorage(root);
    storage.events.append({
      eventId: "evt_broken_candidate",
      projectId: storage.manifest.projectId,
      runId: "run_cli_doctor_0001",
      sessionId: "ses_cli_doctor_0001",
      type: "knowledge.candidate.created",
      occurredAt: "2026-08-19T00:00:00Z",
      actor: { kind: "agent", provider: "codex" },
      schemaVersion: 1,
      policyVersion: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      payload: {
        candidateId: "knc_0123456789abcdef",
        claimDigest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        paths: ["src/decision.ts"],
        evidenceIds: ["evt_missing_evidence"],
        sourceOutcomeId: "dlo_0123456789abcdef",
        decisionArtifactId: "dla_0123456789abcdef",
        verificationArtifactIds: ["dla_1111111111111111"],
        verifiedRevision: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        candidateArtifactId: "art_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        candidateContentHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      },
    });
    await storage.close();

    let issueOutput = "";
    expect(await runCli(["doctor"], {
      cwd: root,
      stdout: (message) => { issueOutput += message; },
      stderr: () => undefined,
    })).toBe(1);
    expect(issueOutput).toContain("candidate_artifact_invalid");
    expect(issueOutput).toContain("확인 필요");
  });
});
