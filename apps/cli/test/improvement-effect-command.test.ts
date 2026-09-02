import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type {
  ImprovementMetricObservationV1,
  ImprovementObservationPortV1,
} from "@lervo/application-contract";
import {
  canonicalJson,
  scanConfiguredRepositoryKnowledge,
  sha256,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

const descriptor = {
  schemaVersion: 1 as const,
  adapterId: "iobs_fixture",
  adapterVersion: "1.0.0",
  descriptorHash: sha256("fixture observation adapter"),
  availability: "available" as const,
  authentication: "adapter_verified" as const,
  rawEvidence: "adapter_private" as const,
  capabilities: ["rate_observation.verify"] as ["rate_observation.verify"],
};

function metric(numerator: number): ImprovementMetricObservationV1 {
  return {
    metricId: "verification_success",
    numerator,
    denominator: 100,
    evidenceSetHash: sha256(`evidence ${numerator}`),
    observationReceiptHash: sha256(`receipt ${numerator}`),
  };
}

const observer: ImprovementObservationPortV1 = {
  inspect: async () => descriptor,
  verify: async (input) => input.observations,
};

it("registers a baseline before promotion and observes effects without automatic rollback", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-improvement-effect-"));
  roots.push(root);
  const output: string[] = [];
  const errors: string[] = [];
  const io = {
    cwd: root,
    stdout: (message: string) => output.push(message),
    stderr: (message: string) => errors.push(message),
  };
  expect(await runCli(["init"], io)).toBe(0);
  const inputDirectory = rootFile(root, ".lervo/state/test-inputs");
  await mkdir(inputDirectory, { recursive: true });
  await writeFile(rootFile(root, "AGENTS.md"), "# Instructions\n\nUse exact evidence.\n");
  await writeFile(rootFile(root, "README.md"), "# Example\n\nRetain review evidence.\n");
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  const agents = scan.units.find((unit) => unit.path === "AGENTS.md")!;
  const readme = scan.units.find((unit) => unit.path === "README.md")!;
  const targetContent = "# Verified change\n\nApply reviewed repository improvements.\n";
  const proposal = {
    schemaVersion: 1 as const,
    title: "Reviewed repository improvements",
    summary: "Apply recurring improvements only after exact review.",
    scope: "repository improvement lifecycle",
    occurrences: [
      { path: agents.path, locator: agents.locator, independentGroup: "instructions" },
      { path: readme.path, locator: readme.locator, independentGroup: "product" },
    ],
    exceptions: ["Read-only inspection does not mutate bytes."],
    affectedInvariants: ["Promotion requires exact review."],
    reasonsToChange: ["Observed effects need a stable baseline."],
    verificationCommands: ["pnpm quality:check"],
    target: {
      kind: "repository_instruction" as const,
      path: "docs/instructions/verified-change.md",
      content: targetContent,
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

  const registeredAt = new Date().toISOString();
  const protocolRequest = {
    schemaVersion: 1 as const,
    patternId: pattern.patternId,
    candidateContentHash: pattern.candidateContentHash,
    reviewContentHash: (JSON.parse(output.pop()!) as { reviewContentHash: string })
      .reviewContentHash,
    targetContentHash: sha256(targetContent),
    requestDigest: sha256(canonicalJson({ purpose: "pre-register verified effect" })),
    adapter: descriptor,
    baselineWindow: {
      startedAt: new Date(Date.now() - 2_000).toISOString(),
      endedAt: new Date(Date.now() - 1_000).toISOString(),
    },
    baseline: [metric(80)],
    registeredAt,
  };
  const protocolPath = resolve(inputDirectory, "protocol.json");
  await writeFile(protocolPath, `${JSON.stringify(protocolRequest)}\n`);
  expect(
    await runCli(
      ["knowledge", "pattern", "effect", "register", "--from", protocolPath, "--json"],
      io,
    ),
  ).toBe(0);
  const protocolPlan = JSON.parse(output.pop()!) as {
    plan: { planId: string; protocolId: string; status: string };
  };
  expect(protocolPlan.plan.status).toBe("ready");
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
    ),
  ).toBe(1);
  expect(errors.pop()).toContain("No improvement observation adapter");
  const registerCode = await runCli(
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
    { improvementObservationPort: observer },
  );
  if (registerCode !== 0) throw new Error(errors.at(-1));

  output.length = 0;
  expect(await runCli(["knowledge", "pattern", "promote", pattern.patternId, "--json"], io)).toBe(
    0,
  );
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

  const now = Date.now();
  const effectRequest = {
    schemaVersion: 1 as const,
    protocolId: protocolPlan.plan.protocolId,
    patternId: pattern.patternId,
    requestDigest: sha256(canonicalJson({ purpose: "observe verified effect" })),
    adapter: descriptor,
    treatmentWindow: {
      startedAt: new Date(now + 1_000).toISOString(),
      endedAt: new Date(now + 2_000).toISOString(),
    },
    treatment: [metric(40)],
    observedAt: new Date(now + 3_000).toISOString(),
  };
  const effectPath = resolve(inputDirectory, "effect.json");
  await writeFile(effectPath, `${JSON.stringify(effectRequest)}\n`);
  output.length = 0;
  expect(
    await runCli(["knowledge", "pattern", "effect", "observe", "--from", effectPath, "--json"], io),
  ).toBe(0);
  const effectPlan = JSON.parse(output.pop()!) as {
    plan: { planId: string; overall: string; rollbackDisposition: string; attribution: string };
  };
  expect(effectPlan.plan).toMatchObject({
    overall: "mixed_or_unfavorable_observation",
    rollbackDisposition: "review_required",
    attribution: "unestablished",
  });
  const applyEffect = () =>
    runCli(
      [
        "knowledge",
        "pattern",
        "effect",
        "observe",
        "--from",
        effectPath,
        "--apply",
        effectPlan.plan.planId,
        "--write",
      ],
      io,
      { improvementObservationPort: observer },
    );
  expect(await applyEffect()).toBe(0);
  const projectionPath = rootFile(root, ".lervo/state/knowledge/improvement-effects/current.json");
  await rm(projectionPath);
  expect(await applyEffect()).toBe(0);
  const projection = JSON.parse(await readFile(projectionPath, "utf8")) as {
    protocols: unknown[];
    effects: unknown[];
  };
  expect(projection.protocols).toHaveLength(1);
  expect(projection.effects).toHaveLength(1);
  expect(await readFile(rootFile(root, proposal.target.path), "utf8")).toBe(targetContent);
});

function rootFile(root: string, path: string): string {
  return resolve(root, path);
}
