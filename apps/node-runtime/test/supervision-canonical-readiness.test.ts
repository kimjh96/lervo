import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { projectOutcomeSupervision } from "@lervo/work-controller";
import { loadSupervisionPlanningContext } from "../src/supervision-planning-context.js";
import { prepareCanonicalSupervisionReadiness } from "../src/supervision-canonical-readiness.js";
import { observeSupervisionRuntimeReadiness } from "../src/supervision-runtime-readiness.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps a real offline role's required source policy unobserved despite filesystem permissions", async () => {
  const f = await dispatchFixture(
    roots,
    true,
    async (root) => {
      await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
      await writeFile(
        resolve(root, ".lervo/roles/offline-evidence.json"),
        JSON.stringify({
          schemaVersion: 1,
          kind: "lervo_repository_role",
          roleId: "offline-evidence",
          version: "1.0.0",
          extends: [{ roleId: "developer", version: "1.0.0" }],
          profile: {
            contextPolicy: {
              requiredDocumentRuleIds: ["repository.instructions", "research.source-policy"],
              minimumAssurance: "E3",
              referencesRequired: true,
            },
          },
          checks: [],
        }),
      );
      return [".lervo/roles/offline-evidence.json"];
    },
    "offline-evidence",
  );
  const report = projectOutcomeSupervision({
    snapshot: f.observation,
    now: f.ports.now(),
    maximumRecoveryDecisions: 1,
  });
  const plan = { ...(await f.ports.propose(report))!, effectContract: "work.managed_execution.v1" };
  const readiness = await prepareCanonicalSupervisionReadiness({
    repositoryRoot: f.root,
    plan,
    responsibility: f.task,
    workstreamRevision: f.observation.workstreamRevision,
    admission: await f.ports.readAdmission(plan),
    aggregateBudgetRequired: true,
    configuration: f.runtimeReadiness,
    now: f.ports.now,
  });
  expect(f.task.requiredCapabilities).not.toContain("network.access");
  expect(readiness.requiredChecks).toContain("source_policy");
  for (const kind of ["source_policy", "knowledge"])
    expect(readiness.observation.checks.find((check) => check.kind === kind)).toMatchObject({
      status: "unobserved",
      evidenceHash: null,
    });
});

it("maps an authorized shell duty to exact CLI and executable evidence without inferring it from the role alone", async () => {
  const f = await dispatchFixture(roots, true, undefined, "developer", undefined, {
    suite: {
      schemaVersion: 1,
      suiteId: "role.development.artifact",
      stopOnFailure: true,
      commands: [
        {
          commandId: "fixture-check",
          executable: "node",
          arguments: ["--version"],
          cwd: ".",
          timeoutMs: 1000,
          maxOutputBytes: 1024,
          environmentVariableNames: [],
        },
      ],
    },
    requiredCapabilities: ["filesystem.read", "shell.execute"],
    taskPurpose: "Compare immutable history using a bounded read-only command.",
  });
  const plan = {
    ...(await f.ports.propose(
      projectOutcomeSupervision({
        snapshot: f.observation,
        now: f.ports.now(),
        maximumRecoveryDecisions: 1,
      }),
    ))!,
    effectContract: "work.managed_execution.v1",
  };
  const input = {
    repositoryRoot: f.root,
    plan,
    responsibility: f.task,
    workstreamRevision: f.observation.workstreamRevision,
    admission: await f.ports.readAdmission(plan),
    aggregateBudgetRequired: true,
    configuration: f.runtimeReadiness,
    now: f.ports.now,
  };
  const canonical = await prepareCanonicalSupervisionReadiness(input);
  expect(canonical.observation.checks.find((check) => check.kind === "cli")).toMatchObject({
    status: "passed",
  });
  const observed = await observeSupervisionRuntimeReadiness({
    plan,
    readiness: canonical,
    configuration: f.runtimeReadiness,
    now: f.ports.now,
  });
  expect(observed.observation.checks.find((check) => check.kind === "cli")).toMatchObject({
    status: "passed",
  });
  const withoutTools = await observeSupervisionRuntimeReadiness({
    plan,
    readiness: canonical,
    configuration: { ...f.runtimeReadiness, verificationTools: {} },
    now: f.ports.now,
  });
  expect(withoutTools.observation.checks.find((check) => check.kind === "cli")).toMatchObject({
    status: "unobserved",
    evidenceHash: null,
  });
});

it("does not promote missing cumulative usage into a per-attempt-only budget failure", async () => {
  const f = await dispatchFixture(roots);
  const plan = {
    ...(await f.ports.propose(
      projectOutcomeSupervision({
        snapshot: f.observation,
        now: f.ports.now(),
        maximumRecoveryDecisions: 1,
      }),
    ))!,
    effectContract: "work.managed_execution.v1",
  };
  const input = {
    repositoryRoot: f.root,
    plan,
    responsibility: f.task,
    workstreamRevision: f.observation.workstreamRevision,
    admission: {
      ...(await f.ports.readAdmission(plan)),
      resourceAdmission: "unobserved" as const,
      observedAggregateTokens: null,
      reservedAggregateTokens: null,
    },
    configuration: f.runtimeReadiness,
    now: f.ports.now,
  };
  const bounded = await prepareCanonicalSupervisionReadiness({
    ...input,
    aggregateBudgetRequired: true,
  });
  const perAttempt = await prepareCanonicalSupervisionReadiness({
    ...input,
    aggregateBudgetRequired: false,
  });
  expect(bounded.observation.checks.find((check) => check.kind === "budget")).toMatchObject({
    status: "unobserved",
    evidenceHash: null,
  });
  expect(perAttempt.observation.checks.find((check) => check.kind === "budget")).toMatchObject({
    status: "passed",
    evidenceHash: expect.stringMatching(/^sha256:/u),
  });
});

it.each([false, true])(
  "measures source loading after retrieval and rejects a slow final read (%s)",
  async (slowRead) => {
    const f = await dispatchFixture(roots);
    const started = Date.parse(f.ports.now());
    let calls = 0;
    const now = () =>
      new Date(
        started + [0, 40_000, slowRead ? 46_000 : 40_000][Math.min(calls++, 2)]!,
      ).toISOString();
    const loading = loadSupervisionPlanningContext({
      repositoryRoot: f.root,
      projectId: f.observation.projectId,
      workstreamId: f.observation.workstreamId,
      workstreamRevision: f.observation.workstreamRevision,
      purpose: f.task.taskPurpose,
      expectedPaths: f.task.expectedPaths,
      now,
    });
    if (slowRead) await expect(loading).rejects.toThrow("observation window");
    else expect((await loading).observedAt).toBe(new Date(started + 40_000).toISOString());
  },
);
