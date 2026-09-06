import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  canonicalJson,
  scanConfiguredRepositoryKnowledge,
  sha256,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { appendLocalVerificationEvidence } from "./improvement-effect-local-fixture.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

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
  const baselineWindow = await appendLocalVerificationEvidence({
    root,
    statuses: [...Array<"passed">(8).fill("passed"), ...Array<"failed">(4).fill("failed")],
    startedAt: Date.now() - 60_000,
  });
  const baselineCollectionPath = resolve(inputDirectory, "baseline-collection.json");
  await writeFile(
    baselineCollectionPath,
    `${JSON.stringify({
      schemaVersion: 1,
      phase: "baseline",
      patternId: pattern.patternId,
      window: baselineWindow,
      metricIds: ["verification_success", "repeated_failure"],
    })}\n`,
  );
  expect(
    await runCli(
      ["knowledge", "pattern", "effect", "collect", "--from", baselineCollectionPath, "--json"],
      io,
    ),
  ).toBe(1);
  expect(errors.pop()).toContain("Collection requires a request and --local-events");
  expect(
    await runCli(
      [
        "knowledge",
        "pattern",
        "effect",
        "collect",
        "--from",
        baselineCollectionPath,
        "--local-events",
        "--json",
      ],
      io,
    ),
  ).toBe(0);
  const baseline = JSON.parse(output.pop()!) as {
    adapter: {
      schemaVersion: 1;
      adapterId: string;
      adapterVersion: string;
      descriptorHash: string;
      availability: "available";
      authentication: "adapter_verified";
      rawEvidence: "adapter_private";
      capabilities: ["rate_observation.verify"];
    };
    observations: Array<{
      metricId: "verification_success" | "repeated_failure";
      numerator: number;
      denominator: number;
      evidenceSetHash: string;
      observationReceiptHash: string;
    }>;
    unavailable: unknown[];
    canonicalMutation: string;
  };
  expect(baseline).toMatchObject({
    unavailable: [],
    canonicalMutation: "none",
  });
  const descriptor = baseline.adapter;
  const baselineObservations = baseline.observations;
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
    baseline: baselineObservations,
    registeredAt,
  };
  const protocolPath = resolve(inputDirectory, "protocol.json");
  await writeFile(protocolPath, `${JSON.stringify(protocol)}\n`);
  expect(
    await runCli(
      ["knowledge", "pattern", "effect", "register", "--from", protocolPath, "--json"],
      io,
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
        "--local-events",
      ],
      io,
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
  const treatmentWindow = await appendLocalVerificationEvidence({
    root,
    statuses: [...Array<"passed">(11).fill("passed"), "failed"],
    startedAt: Date.now() + 1_000,
  });
  const treatmentCollectionPath = resolve(inputDirectory, "treatment-collection.json");
  await writeFile(
    treatmentCollectionPath,
    `${JSON.stringify({
      schemaVersion: 1,
      phase: "treatment",
      patternId: pattern.patternId,
      window: treatmentWindow,
      metricIds: ["verification_success", "repeated_failure"],
    })}\n`,
  );
  output.length = 0;
  expect(
    await runCli(
      [
        "knowledge",
        "pattern",
        "effect",
        "collect",
        "--from",
        treatmentCollectionPath,
        "--local-events",
        "--json",
      ],
      io,
    ),
  ).toBe(0);
  const treatment = JSON.parse(output.pop()!) as {
    observations: typeof baselineObservations;
    unavailable: unknown[];
  };
  expect(treatment.unavailable).toEqual([]);
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
        "--local-events",
      ],
      io,
    ),
  ).toBe(0);
  expect(errors).toEqual([]);
}, 15_000);
