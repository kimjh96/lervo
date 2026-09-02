import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createProjectStorageImprovementObservationAdapter } from "@lervo/improvement-observation-local";
import { openProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  scanConfiguredRepositoryKnowledge,
  sha256,
} from "@lervo/repository-knowledge";
import { loadVerificationSuite, runVerificationSuite } from "@lervo/verification";
import { afterEach, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function appendVerificationEvidence(input: {
  root: string;
  statuses: Array<"passed" | "failed">;
  startedAt: number;
}): Promise<{ startedAt: string; endedAt: string }> {
  const storage = await openProjectStorage(input.root);
  const completed: string[] = [];
  try {
    const suite = await loadVerificationSuite(input.root, "observation.fixture");
    for (const [index, status] of input.statuses.entries()) {
      let clock = input.startedAt + index * 10;
      const repositoryRevision = sha256(`revision ${index} ${input.startedAt}`);
      const verification = await runVerificationSuite(
        {
          repositoryRoot: input.root,
          repositoryRevision,
          suite,
          artifactStore: storage.artifacts,
          captureRepositoryRevision: async () => repositoryRevision,
        },
        {
          now: () => new Date(clock++),
          environment: { ...process.env, OBSERVATION_FAIL: status === "failed" ? "1" : "0" },
        },
      );
      const identity = randomBytes(8).toString("hex");
      completed.push(verification.result.completedAt);
      storage.events.append({
        eventId: `evt_${identity}`,
        projectId: storage.manifest.projectId,
        runId: `run_${identity}`,
        sessionId: `ses_${identity}`,
        type: "verification.completed",
        occurredAt: verification.result.completedAt,
        actor: { kind: "system" },
        schemaVersion: 1,
        policyVersion: sha256(`policy ${identity}`),
        payload: {
          verificationId: verification.result.verificationId,
          suiteId: verification.result.suiteId,
          suiteHash: verification.result.suiteHash,
          repositoryRevision: verification.result.repositoryRevision,
          status: verification.result.status,
          resultArtifactId: verification.resultArtifact.artifactId,
          resultContentHash: verification.resultArtifact.contentHash,
          nonPassedCommandIds: verification.result.commands
            .filter((command) => command.status !== "passed")
            .map((command) => command.commandId),
        },
      });
    }
  } finally {
    await storage.close();
  }
  return {
    startedAt: completed[0]!,
    endedAt: completed.at(-1)!,
  };
}

it("dogfoods local verification telemetry through explicit CLI host injection", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-local-improvement-observer-"));
  roots.push(root);
  const output: string[] = [];
  const errors: string[] = [];
  const io = {
    cwd: root,
    stdout: (message: string) => output.push(message),
    stderr: (message: string) => errors.push(message),
  };
  expect(await runCli(["init"], io)).toBe(0);
  const inputDirectory = resolve(root, ".lervo/state/test-inputs");
  await Promise.all([
    mkdir(inputDirectory, { recursive: true }),
    mkdir(resolve(root, ".lervo/verifications"), { recursive: true }),
  ]);
  await writeFile(
    resolve(root, ".lervo/verifications/observation.fixture.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: observation.fixture",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: observation-check",
      "    executable: node",
      "    arguments:",
      "      - -e",
      "      - 'process.exit(process.env.OBSERVATION_FAIL === \"1\" ? 1 : 0)'",
      "    cwd: .",
      "    timeoutMs: 10000",
      "    maxOutputBytes: 1024",
      "    environmentVariableNames:",
      "      - OBSERVATION_FAIL",
      "",
    ].join("\n"),
  );
  await writeFile(resolve(root, "AGENTS.md"), "# Instructions\n\nUse verified evidence.\n");
  await writeFile(resolve(root, "README.md"), "# Example\n\nReview every promotion.\n");
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  const proposal = {
    schemaVersion: 1 as const,
    title: "Verified local observations",
    summary: "Measure reviewed changes from canonical local verification events.",
    scope: "repository improvement observation",
    occurrences: [
      {
        path: "AGENTS.md",
        locator: scan.units.find((unit) => unit.path === "AGENTS.md")!.locator,
        independentGroup: "instructions",
      },
      {
        path: "README.md",
        locator: scan.units.find((unit) => unit.path === "README.md")!.locator,
        independentGroup: "product",
      },
    ],
    exceptions: ["Unsupported metrics remain unavailable."],
    affectedInvariants: ["Promotion requires exact review."],
    reasonsToChange: ["Local outcomes need reproducible measurement."],
    verificationCommands: ["pnpm quality:check"],
    target: {
      kind: "repository_instruction" as const,
      path: "docs/instructions/local-observations.md",
      content: "# Local observations\n\nUse canonical verification evidence.\n",
    },
  };
  const proposalPath = resolve(inputDirectory, "proposal.json");
  await writeFile(proposalPath, `${JSON.stringify(proposal)}\n`);
  expect(
    await runCli(
      ["knowledge", "pattern", "propose", "--provider", "codex", "--from", proposalPath, "--json"],
      io,
    ),
  ).toBe(0);
  const pattern = JSON.parse(output.pop()!) as {
    patternId: string;
    candidateContentHash: string;
  };
  expect(
    await runCli(
      [
        "knowledge",
        "pattern",
        "review",
        pattern.patternId,
        "--decision",
        "accept",
        "--reviewer",
        "repository-maintainer",
        "--approval",
        pattern.candidateContentHash,
        "--json",
      ],
      io,
    ),
  ).toBe(0);
  const reviewContentHash = (JSON.parse(output.pop()!) as { reviewContentHash: string })
    .reviewContentHash;
  const adapter = createProjectStorageImprovementObservationAdapter({ repositoryRoot: root });
  const baselineWindow = await appendVerificationEvidence({
    root,
    statuses: [...Array<"passed">(8).fill("passed"), ...Array<"failed">(4).fill("failed")],
    startedAt: Date.now() - 60_000,
  });
  const descriptor = await adapter.inspect("iobs_lervo_local_events");
  const baseline = await adapter.collect({
    phase: "baseline",
    patternId: pattern.patternId,
    window: baselineWindow,
    metricIds: ["verification_success"],
  });
  expect(baseline.unavailable).toEqual([]);
  const registeredAt = new Date().toISOString();
  const protocol = {
    schemaVersion: 1 as const,
    patternId: pattern.patternId,
    candidateContentHash: pattern.candidateContentHash,
    reviewContentHash,
    targetContentHash: sha256(proposal.target.content),
    requestDigest: sha256(canonicalJson({ purpose: "local baseline" })),
    adapter: descriptor,
    baselineWindow,
    baseline: baseline.observations,
    registeredAt,
  };
  const protocolPath = resolve(inputDirectory, "protocol.json");
  await writeFile(protocolPath, `${JSON.stringify(protocol)}\n`);
  expect(
    await runCli(
      ["knowledge", "pattern", "effect", "register", "--from", protocolPath, "--json"],
      io,
      { improvementObservationPort: adapter },
    ),
  ).toBe(0);
  const protocolPlan = JSON.parse(output.pop()!) as {
    plan: { planId: string; protocolId: string };
  };
  expect(
    await runCli(
      [
        "knowledge",
        "pattern",
        "effect",
        "register",
        "--from",
        protocolPath,
        "--apply",
        protocolPlan.plan.planId,
        "--write",
      ],
      io,
      { improvementObservationPort: adapter },
    ),
  ).toBe(0);

  output.length = 0;
  const promotePlanCode = await runCli(
    ["knowledge", "pattern", "promote", pattern.patternId, "--json"],
    io,
  );
  if (promotePlanCode !== 0) throw new Error(errors.at(-1));
  const promotionPlan = JSON.parse(output.pop()!) as { planId: string };
  expect(
    await runCli(
      [
        "knowledge",
        "pattern",
        "promote",
        pattern.patternId,
        "--apply",
        "--approval",
        promotionPlan.planId,
      ],
      io,
    ),
  ).toBe(0);
  const treatmentWindow = await appendVerificationEvidence({
    root,
    statuses: [...Array<"passed">(11).fill("passed"), "failed"],
    startedAt: Date.now() + 1_000,
  });
  const treatment = await adapter.collect({
    phase: "treatment",
    patternId: pattern.patternId,
    window: treatmentWindow,
    metricIds: ["verification_success"],
  });
  const observation = {
    schemaVersion: 1 as const,
    protocolId: protocolPlan.plan.protocolId,
    patternId: pattern.patternId,
    requestDigest: sha256(canonicalJson({ purpose: "local treatment" })),
    adapter: descriptor,
    treatmentWindow,
    treatment: treatment.observations,
    observedAt: new Date(Date.parse(treatmentWindow.endedAt) + 1_000).toISOString(),
  };
  const observationPath = resolve(inputDirectory, "observation.json");
  await writeFile(observationPath, `${JSON.stringify(observation)}\n`);
  output.length = 0;
  expect(
    await runCli(
      ["knowledge", "pattern", "effect", "observe", "--from", observationPath, "--json"],
      io,
      { improvementObservationPort: adapter },
    ),
  ).toBe(0);
  const observationPlan = JSON.parse(output.pop()!) as {
    plan: { planId: string; overall: string; attribution: string };
  };
  expect(observationPlan.plan).toMatchObject({
    overall: "favorable_observation",
    attribution: "unestablished",
  });
  expect(
    await runCli(
      [
        "knowledge",
        "pattern",
        "effect",
        "observe",
        "--from",
        observationPath,
        "--apply",
        observationPlan.plan.planId,
        "--write",
      ],
      io,
      { improvementObservationPort: adapter },
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
});
