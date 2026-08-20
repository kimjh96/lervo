import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { DoctorInspection } from "@lervo/diagnostics";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const temporaryRoots: string[] = [];
const healthyEnvironmentInspections: DoctorInspection[] = [
  "document_registry",
  "document_sources",
  "skill_packages",
  "skill_lock",
  "provider_codex_runtime",
  "provider_claude_runtime",
  "search_engine_selection",
  "search_rollout_policies",
  "search_rollout_reviews",
  "search_rollout_actions",
].map((checkId) => ({
  check: {
    checkId: checkId as DoctorInspection["check"]["checkId"],
    status: "healthy",
    observedCount: checkId.startsWith("provider_") ? 1 : 0,
  },
  issues: [],
}));

const doctorServices = {
  inspectDoctorEnvironment: async () => healthyEnvironmentInspections,
};

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-doctor-command-"));
  temporaryRoots.push(root);
  return root;
}

async function initializeRepository(root: string): Promise<void> {
  expect(await runCli(["init"], {
    cwd: root,
    stdout: () => undefined,
    stderr: () => undefined,
  })).toBe(0);
}

async function appendBrokenKnowledgeCandidate(root: string): Promise<void> {
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
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("lervo doctor command", () => {
  it("reports healthy storage and fails closed on a broken candidate reference", async () => {
    const root = await temporaryRepository();
    await initializeRepository(root);
    let healthyOutput = "";
    expect(await runCli(["doctor"], {
      cwd: root,
      stdout: (message) => { healthyOutput += message; },
      stderr: () => undefined,
    }, doctorServices)).toBe(0);
    expect(healthyOutput).toContain("확인한 항목 정상");
    expect(healthyOutput).not.toContain("다음 확인:");

    await appendBrokenKnowledgeCandidate(root);
    let issueOutput = "";
    expect(await runCli(["doctor"], {
      cwd: root,
      stdout: (message) => { issueOutput += message; },
      stderr: () => undefined,
    }, doctorServices)).toBe(1);
    expect(issueOutput).toContain("candidate_artifact_invalid");
    expect(issueOutput).toContain("문제 발견");
  });

  it("returns unknown instead of healthy when a provider runtime cannot be checked", async () => {
    const root = await temporaryRepository();
    await initializeRepository(root);
    const inspections = structuredClone(healthyEnvironmentInspections);
    const codex = inspections.find((item) =>
      item.check.checkId === "provider_codex_runtime")!;
    codex.check.status = "unknown";
    codex.check.observedCount = 0;
    codex.issues.push({
      code: "provider_executable_missing",
      eventId: null,
      message: "Codex 실행 파일을 찾지 못했습니다.",
    });
    let output = "";

    expect(await runCli(["doctor"], {
      cwd: root,
      stdout: (message) => { output += message; },
      stderr: () => undefined,
    }, {
      inspectDoctorEnvironment: async () => inspections,
    })).toBe(1);
    expect(output).toContain("확인 불가 항목 있음");
    expect(output).toContain("확인 불가  Codex 실행 파일");
    expect(output).toContain("provider_executable_missing");
  });

  it("reports an invalid search rollout action as a doctor failure", async () => {
    const root = await temporaryRepository();
    await initializeRepository(root);
    const inspections = structuredClone(healthyEnvironmentInspections);
    const actions = inspections.find((item) =>
      item.check.checkId === "search_rollout_actions")!;
    actions.check.status = "unhealthy";
    actions.issues.push({
      code: "search_rollout_action_invalid",
      eventId: null,
      message: "검색 rollout 조치와 연결 근거를 안전하게 검증하지 못했습니다.",
    });
    let output = "";

    expect(await runCli(["doctor"], {
      cwd: root,
      stdout: (message) => { output += message; },
      stderr: () => undefined,
    }, {
      inspectDoctorEnvironment: async () => inspections,
    })).toBe(1);
    expect(output).toContain("문제  검색 rollout 조치");
    expect(output).toContain("search_rollout_action_invalid");
    expect(output).toContain("다음 확인:");
    expect(output).toContain("inspect_search_action");
    expect(output).toContain("자동 수정이나 상태 변경은 실행하지 않았습니다");

    let jsonOutput = "";
    expect(await runCli(["doctor", "--json"], {
      cwd: root,
      stdout: (message) => { jsonOutput += message; },
      stderr: () => undefined,
    }, {
      inspectDoctorEnvironment: async () => inspections,
    })).toBe(1);
    expect(JSON.parse(jsonOutput)).toMatchObject({
      recoveryGuidance: [{
        issueCode: "search_rollout_action_invalid",
        actionCode: "inspect_search_action",
        actionState: "not_performed",
      }],
    });
  });

  it("runs only search diagnostics and declares the limited scope in text and JSON", async () => {
    const root = await temporaryRepository();
    await initializeRepository(root);
    await appendBrokenKnowledgeCandidate(root);
    const searchInspections = healthyEnvironmentInspections.filter((inspection) =>
      inspection.check.checkId.startsWith("search_"));
    const observedScopes: Array<string | undefined> = [];
    const services = {
      openProjectStorage: async () => {
        throw new Error("검색 범위에서 project storage를 열면 안 됩니다.");
      },
      inspectDoctorEnvironment: async (input: { scope?: string }) => {
        observedScopes.push(input.scope);
        return searchInspections;
      },
    };
    let textOutput = "";

    expect(await runCli(["doctor", "--scope", "search"], {
      cwd: root,
      stdout: (message) => { textOutput += message; },
      stderr: () => undefined,
    }, services)).toBe(0);
    expect(textOutput).toContain("Lervo 검색 범위 진단 결과: 확인한 항목 정상");
    expect(textOutput).toContain("프로젝트 전체 상태를 뜻하지 않습니다");
    expect(textOutput).not.toContain("지식 후보 근거");

    let jsonOutput = "";
    expect(await runCli(["doctor", "--scope", "search", "--json"], {
      cwd: root,
      stdout: (message) => { jsonOutput += message; },
      stderr: () => undefined,
    }, services)).toBe(0);
    const report = JSON.parse(jsonOutput) as {
      scope: string;
      status: string;
      checks: Array<{ checkId: string }>;
    };
    expect(report).toMatchObject({ scope: "search", status: "healthy" });
    expect(report.checks.map((check) => check.checkId)).toEqual([
      "search_engine_selection",
      "search_rollout_policies",
      "search_rollout_reviews",
      "search_rollout_actions",
    ]);
    expect(observedScopes).toEqual(["search", "search"]);
  });

  it("rejects an unknown doctor scope before opening project storage", async () => {
    let opened = false;
    let errorOutput = "";

    expect(await runCli(["doctor", "--scope", "providers"], {
      cwd: "/unused",
      stdout: () => undefined,
      stderr: (message) => { errorOutput += message; },
    }, {
      openProjectStorage: async () => {
        opened = true;
        throw new Error("must not open");
      },
    })).toBe(1);
    expect(opened).toBe(false);
    expect(errorOutput).toContain("지원하지 않는 doctor 범위입니다: providers");
    expect(errorOutput).toContain("--scope <all|search>");
  });
});
