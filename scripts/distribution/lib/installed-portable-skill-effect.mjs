import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runInstalledVerificationBatch } from "./installed-portable-skill-verification.mjs";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function writeRequest(root, name, request) {
  const path = resolve(root, `.lervo/state/installed-portable-skill-${name}.json`);
  await writeFile(path, `${JSON.stringify(request, null, 2)}\n`);
  return path;
}

async function collect(input, phase, window) {
  const requestPath = await writeRequest(input.root, `${phase}-collection`, {
    schemaVersion: 1,
    phase,
    patternId: input.patternId,
    window,
    metricIds: ["verification_success", "repeated_failure"],
  });
  const collected = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "knowledge",
        "pattern",
        "effect",
        "collect",
        "--from",
        requestPath,
        "--local-events",
        "--json",
      ])
    ).stdout,
  );
  assert.deepEqual(collected.unavailable, []);
  assert.equal(collected.canonicalMutation, "none");
  return collected;
}

function assertPassingWindow(collection) {
  const observations = Object.fromEntries(
    collection.observations.map((observation) => [observation.metricId, observation]),
  );
  assert.equal(observations.verification_success.numerator, 10);
  assert.equal(observations.verification_success.denominator, 10);
  assert.equal(observations.repeated_failure.numerator, 0);
  assert.equal(observations.repeated_failure.denominator, 10);
}

export async function registerInstalledPortableSkillBaseline(input) {
  const baseline = await collect(input, "baseline", input.baselineWindow);
  assertPassingWindow(baseline);
  const protocolPath = await writeRequest(input.root, "effect-protocol", {
    schemaVersion: 1,
    patternId: input.patternId,
    candidateContentHash: input.candidateContentHash,
    reviewContentHash: input.reviewContentHash,
    targetContentHash: sha256(input.targetContent),
    requestDigest: sha256(JSON.stringify({ purpose: "installed portable skill baseline" })),
    adapter: baseline.adapter,
    baselineWindow: input.baselineWindow,
    baseline: baseline.observations,
    registeredAt: new Date().toISOString(),
  });
  const planned = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "knowledge",
        "pattern",
        "effect",
        "register",
        "--from",
        protocolPath,
        "--json",
      ])
    ).stdout,
  );
  const applied = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "knowledge",
        "pattern",
        "effect",
        "register",
        "--from",
        protocolPath,
        "--apply",
        planned.plan.planId,
        "--write",
        "--local-events",
        "--json",
      ])
    ).stdout,
  );
  assert.ok(applied.registrationEventId);
  assert.equal(applied.plan.protocolId, planned.plan.protocolId);
  return { adapter: baseline.adapter, protocolId: applied.plan.protocolId };
}

export async function observeInstalledPortableSkillTreatment(input) {
  const treatmentEvidence = await runInstalledVerificationBatch(
    input,
    Array.from({ length: 10 }, (_, index) => `treatment-${index + 1}`),
  );
  const treatment = await collect(input, "treatment", treatmentEvidence.window);
  assertPassingWindow(treatment);
  const observationPath = await writeRequest(input.root, "effect-observation", {
    schemaVersion: 1,
    protocolId: input.protocolId,
    patternId: input.patternId,
    requestDigest: sha256(JSON.stringify({ purpose: "installed portable skill treatment" })),
    adapter: input.adapter,
    treatmentWindow: treatmentEvidence.window,
    treatment: treatment.observations,
    observedAt: new Date(Date.parse(treatmentEvidence.window.endedAt) + 1_000).toISOString(),
  });
  const planned = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "knowledge",
        "pattern",
        "effect",
        "observe",
        "--from",
        observationPath,
        "--json",
      ])
    ).stdout,
  );
  assert.equal(planned.plan.overall, "no_material_difference");
  assert.equal(planned.plan.attribution, "unestablished");
  assert.equal(planned.plan.rollbackDisposition, "not_authorized");
  const applied = JSON.parse(
    (
      await input.runCli(input.cli, input.root, [
        "knowledge",
        "pattern",
        "effect",
        "observe",
        "--from",
        observationPath,
        "--apply",
        planned.plan.planId,
        "--write",
        "--local-events",
        "--json",
      ])
    ).stdout,
  );
  assert.ok(applied.observationEventId);
  assert.equal(applied.plan.comparisonId, planned.plan.comparisonId);
  return {
    comparisonId: applied.plan.comparisonId,
    overall: planned.plan.overall,
    attribution: planned.plan.attribution,
    rollbackDisposition: planned.plan.rollbackDisposition,
  };
}
