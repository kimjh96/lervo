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
  expect(
    await runCli(["init"], {
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
    }),
  ).toBe(0);
}

async function appendHistoricalKnowledgeCandidate(root: string): Promise<void> {
  const storage = await openProjectStorage(root);
  storage.events.append({
    eventId: "evt_historical_candidate",
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
      candidateContentHash:
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
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
  it("reports healthy storage and reads a stored knowledge candidate as opaque history", async () => {
    const root = await temporaryRepository();
    await initializeRepository(root);
    let healthyOutput = "";
    expect(
      await runCli(
        ["doctor"],
        {
          cwd: root,
          stdout: (message) => {
            healthyOutput += message;
          },
          stderr: () => undefined,
        },
        doctorServices,
      ),
    ).toBe(0);
    expect(healthyOutput).toContain("checked items are healthy");
    expect(healthyOutput).not.toContain("Next checks:");

    await appendHistoricalKnowledgeCandidate(root);
    let historyOutput = "";
    expect(
      await runCli(
        ["doctor"],
        {
          cwd: root,
          stdout: (message) => {
            historyOutput += message;
          },
          stderr: () => undefined,
        },
        doctorServices,
      ),
    ).toBe(0);
    expect(historyOutput).toContain("checked items are healthy");
    expect(historyOutput).not.toContain("candidate");
  });

  it("returns unknown instead of healthy when a provider runtime cannot be checked", async () => {
    const root = await temporaryRepository();
    await initializeRepository(root);
    const inspections = structuredClone(healthyEnvironmentInspections);
    const codex = inspections.find((item) => item.check.checkId === "provider_codex_runtime")!;
    codex.check.status = "unknown";
    codex.check.observedCount = 0;
    codex.issues.push({
      code: "provider_executable_missing",
      eventId: null,
      message: "The Codex executable was not found.",
    });
    let output = "";

    expect(
      await runCli(
        ["doctor"],
        {
          cwd: root,
          stdout: (message) => {
            output += message;
          },
          stderr: () => undefined,
        },
        {
          inspectDoctorEnvironment: async () => inspections,
        },
      ),
    ).toBe(1);
    expect(output).toContain("some items could not be determined");
    expect(output).toContain("unknown  Codex executable");
    expect(output).toContain("provider_executable_missing");
  });

  it("reports an invalid search rollout action as a doctor failure", async () => {
    const root = await temporaryRepository();
    await initializeRepository(root);
    const inspections = structuredClone(healthyEnvironmentInspections);
    const actions = inspections.find((item) => item.check.checkId === "search_rollout_actions")!;
    actions.check.status = "unhealthy";
    actions.issues.push({
      code: "search_rollout_action_invalid",
      eventId: null,
      message: "The search rollout action and linked evidence could not be verified safely.",
    });
    let output = "";

    expect(
      await runCli(
        ["doctor"],
        {
          cwd: root,
          stdout: (message) => {
            output += message;
          },
          stderr: () => undefined,
        },
        {
          inspectDoctorEnvironment: async () => inspections,
        },
      ),
    ).toBe(1);
    expect(output).toContain("unhealthy  search rollout actions");
    expect(output).toContain("search_rollout_action_invalid");
    expect(output).toContain("Next checks:");
    expect(output).toContain("inspect_search_action");
    expect(output).toContain("No automatic fixes or state changes were performed");

    let jsonOutput = "";
    expect(
      await runCli(
        ["doctor", "--json"],
        {
          cwd: root,
          stdout: (message) => {
            jsonOutput += message;
          },
          stderr: () => undefined,
        },
        {
          inspectDoctorEnvironment: async () => inspections,
        },
      ),
    ).toBe(1);
    expect(JSON.parse(jsonOutput)).toMatchObject({
      schemaVersion: 2,
      recoveryGuidance: [
        {
          issueCode: "search_rollout_action_invalid",
          actionCode: "inspect_search_action",
          actionState: "not_performed",
        },
      ],
    });
  });
});
