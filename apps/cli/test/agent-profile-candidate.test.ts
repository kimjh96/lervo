import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type {
  ImprovementMetricObservationV1,
  ImprovementObservationPortV1,
} from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { scanConfiguredRepositoryKnowledge, sha256 } from "@lervo/repository-knowledge";
import { renderRepositoryRoleSource, resolveRoleContract, roleProfileHash } from "@lervo/roles";
import { afterEach, expect, it } from "vitest";
import { loadVerificationSuite } from "@lervo/verification";
import {
  calculateVerificationId,
  verificationCommandDigest,
  verificationResultBytes,
  verificationSuiteHash,
} from "@lervo/verification-contract";

import { runCli } from "../src/main.js";
import { collectLocalKnowledgeSources } from "../src/knowledge-sources.js";
import { activateFixtureEventWriterV2 } from "../../../packages/project/test/fixture-event-writer.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const descriptor = {
  schemaVersion: 1 as const,
  adapterId: "iobs_agent_profile_fixture",
  adapterVersion: "1.0.0",
  descriptorHash: sha256("agent-profile observation adapter"),
  availability: "available" as const,
  authentication: "adapter_verified" as const,
  rawEvidence: "adapter_private" as const,
  capabilities: ["rate_observation.verify"] as ["rate_observation.verify"],
};

function metric(numerator: number): ImprovementMetricObservationV1 {
  return {
    metricId: "verification_success",
    numerator,
    denominator: 10,
    evidenceSetHash: sha256(`agent-profile-evidence-${numerator}`),
    observationReceiptHash: sha256(`agent-profile-receipt-${numerator}`),
  };
}

const observer: ImprovementObservationPortV1 = {
  inspect: async () => descriptor,
  verify: async (input) => input.observations,
};

async function seedManagedEvidence(root: string) {
  const storage = await openProjectStorage(root);
  try {
    const sourceRole = await resolveRoleContract(root, "developer");
    const suite = await loadVerificationSuite(root, "repository.default");
    const suiteHash = verificationSuiteHash(suite);
    const emptyOutput = await storage.artifacts.put("");
    const outputArtifact = {
      artifactId: `art_${emptyOutput.contentHash.slice("sha256:".length)}`,
      uri: emptyOutput.uri,
      contentHash: emptyOutput.contentHash,
      byteCount: 0,
    };
    const references = [];
    for (const [index, provider] of (["codex", "claude"] as const).entries()) {
      const suffix = index === 0 ? "a" : "b";
      const runId = `run_profile_${suffix.repeat(8)}`;
      const sessionId = `ses_profile_${suffix.repeat(8)}`;
      const occurredAt = `2026-09-06T00:0${index}:00.000Z`;
      const runtimeProfileHash = sha256(`runtime-${suffix}`);
      const activation = storage.events.append({
        eventId: `evt_${suffix.repeat(32)}`,
        projectId: storage.manifest.projectId,
        runId,
        sessionId,
        type: "role.profile.activated",
        occurredAt,
        actor: { kind: "system" },
        schemaVersion: 2,
        policyVersion: runtimeProfileHash,
        payload: {
          activationId: `rpact_${suffix.repeat(24)}`,
          provider,
          roleId: sourceRole.roleId,
          roleVersion: sourceRole.version,
          roleContractHash: sourceRole.contractHash,
          roleProfileHash: roleProfileHash(sourceRole.definition.profile),
          runtimeProfileHash,
          sourceKind: sourceRole.sourceKind,
          activatedAt: occurredAt,
        },
      }).event;
      const repositoryRevision = sha256(`revision-${suffix}`);
      const resultWithoutId = {
        schemaVersion: 1 as const,
        suiteId: suite.suiteId,
        suiteHash,
        repositoryRevision,
        startedAt: occurredAt,
        completedAt: occurredAt,
        status: "passed" as const,
        commands: suite.commands.map((command) => ({
          commandId: command.commandId,
          commandDigest: verificationCommandDigest(command),
          status: "passed" as const,
          exitCode: 0,
          startedAt: occurredAt,
          completedAt: occurredAt,
          durationMs: 0,
          stdoutArtifact: outputArtifact,
          stderrArtifact: outputArtifact,
          failureCode: null,
        })),
      };
      const result = {
        ...resultWithoutId,
        verificationId: calculateVerificationId(resultWithoutId),
      };
      const artifact = await storage.artifacts.put(verificationResultBytes(result));
      const verification = storage.events.append({
        eventId: `evt_${suffix.repeat(31)}1`,
        projectId: storage.manifest.projectId,
        runId,
        sessionId,
        type: "verification.completed",
        occurredAt,
        actor: { kind: "system" },
        schemaVersion: 2,
        policyVersion: runtimeProfileHash,
        payload: {
          verificationId: result.verificationId,
          suiteId: suite.suiteId,
          suiteHash,
          repositoryRevision,
          status: "passed",
          resultArtifactId: `art_${artifact.contentHash.slice("sha256:".length)}`,
          resultContentHash: artifact.contentHash,
          nonPassedCommandIds: [],
        },
      }).event;
      references.push({
        independentGroup: `profile-${suffix}`,
        activation: {
          eventId: activation.eventId,
          eventHash: activation.eventHash,
          runId,
          provider,
          roleId: sourceRole.roleId,
          roleVersion: sourceRole.version,
          roleContractHash: sourceRole.contractHash,
          roleProfileHash: roleProfileHash(sourceRole.definition.profile),
          runtimeProfileHash,
        },
        verification: {
          independentGroup: `profile-${suffix}`,
          eventId: verification.eventId,
          eventHash: verification.eventHash,
          runId,
          verificationId: result.verificationId,
          suiteHash,
          repositoryRevision,
          resultContentHash: artifact.contentHash,
        },
      });
    }
    return references;
  } finally {
    await storage.close();
  }
}

it("reviews, activates, observes, and rolls back an evidence-bound agent profile", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-profile-cli-"));
  roots.push(root);
  const output: string[] = [];
  const errors: string[] = [];
  const io = {
    cwd: root,
    stdout: (message: string) => output.push(message),
    stderr: (message: string) => errors.push(message),
  };
  expect(await runCli(["init"], io)).toBe(0);
  await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
  await writeFile(
    resolve(root, ".lervo/verifications/repository.default.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: repository.default",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: repository.default",
      "    executable: node",
      "    arguments: [--version]",
      '    cwd: "."',
      "    timeoutMs: 1000",
      "    maxOutputBytes: 1024",
      "    environmentVariableNames: []",
      "",
    ].join("\n"),
  );
  const project = await openProjectStorage(root);
  const projectId = project.manifest.projectId;
  await project.close();
  await activateFixtureEventWriterV2({
    repositoryRoot: root,
    projectId,
    observedAt: "2026-09-06T00:00:00.000Z",
  });
  await mkdir(resolve(root, "evidence"));
  await writeFile(resolve(root, "evidence/a.md"), "# First profile run\n\nPassed.\n");
  await writeFile(resolve(root, "evidence/b.md"), "# Second profile run\n\nPassed.\n");
  const references = await seedManagedEvidence(root);
  const { scan } = await scanConfiguredRepositoryKnowledge(root, {
    supplementalSources: await collectLocalKnowledgeSources(root),
  });
  const occurrences = ["a", "b"].map((suffix) => {
    const unit = scan.units.find((item) => item.path === `evidence/${suffix}.md`)!;
    return {
      path: unit.path,
      locator: unit.locator,
      independentGroup: `profile-${suffix}`,
    };
  });
  const targetContent = renderRepositoryRoleSource({
    schemaVersion: 1,
    kind: "lervo_repository_role",
    roleId: "evidence-developer",
    version: "1.0.0",
    extends: [{ roleId: "developer", version: "1.0.0" }],
    profile: {
      name: "Evidence Developer",
      description: "Uses the exact reviewed evidence-development contract.",
      requestTypes: ["implementation.evidence"],
    },
    checks: [],
  });
  const proposal = {
    schemaVersion: 1,
    title: "Evidence developer profile",
    summary: "Create a repository role from two independently verified managed runs.",
    scope: "repository role profile",
    occurrences,
    exceptions: ["Built-in roles remain unchanged."],
    affectedInvariants: ["Managed role contracts remain exact-version and hash bound."],
    reasonsToChange: ["Two distinct managed runs passed verification."],
    verificationCommands: ["pnpm quality:check"],
    target: {
      kind: "agent_profile",
      path: ".lervo/roles/evidence-developer.json",
      content: targetContent,
      expectedCurrentHash: null,
    },
    agentProfileEvidence: references,
  };

  output.length = 0;
  expect(
    await runCli(["role", "candidate", "propose", "--provider", "codex", "--stdin", "--json"], {
      ...io,
      stdin: async () => JSON.stringify(proposal),
    }),
  ).toBe(0);
  const candidate = JSON.parse(output.pop()!) as {
    patternId: string;
    candidateContentHash: string;
  };
  output.length = 0;
  expect(
    await runCli(
      [
        "role",
        "candidate",
        "review",
        candidate.patternId,
        "--decision",
        "accept",
        "--reviewer",
        "repository-maintainer",
        "--approval",
        candidate.candidateContentHash,
        "--json",
      ],
      io,
    ),
  ).toBe(0);
  const reviewed = JSON.parse(output.pop()!) as { reviewContentHash: string };

  const registeredAt = new Date().toISOString();
  const protocol = {
    schemaVersion: 1 as const,
    patternId: candidate.patternId,
    candidateContentHash: candidate.candidateContentHash,
    reviewContentHash: reviewed.reviewContentHash,
    targetContentHash: sha256(targetContent),
    requestDigest: sha256("agent-profile effect baseline"),
    adapter: descriptor,
    baselineWindow: {
      startedAt: new Date(Date.now() - 2_000).toISOString(),
      endedAt: new Date(Date.now() - 1_000).toISOString(),
    },
    baseline: [metric(7)],
    registeredAt,
  };
  const protocolPath = resolve(root, ".lervo/profile-protocol.json");
  await writeFile(protocolPath, `${JSON.stringify(protocol)}\n`);
  output.length = 0;
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
      ],
      io,
      { improvementObservationPort: observer },
    ),
  ).toBe(0);

  output.length = 0;
  expect(await runCli(["role", "candidate", "activate", candidate.patternId, "--json"], io)).toBe(
    0,
  );
  const activationPlan = JSON.parse(output.pop()!) as { planId: string; status: string };
  expect(activationPlan.status).toBe("ready");
  expect(JSON.stringify(activationPlan)).not.toContain("Evidence Developer");
  output.length = 0;
  expect(
    await runCli(
      [
        "role",
        "candidate",
        "activate",
        candidate.patternId,
        "--apply",
        "--approval",
        activationPlan.planId,
        "--json",
      ],
      io,
    ),
  ).toBe(0);
  const activated = JSON.parse(output.pop()!) as { promotedAt: string };
  expect((await resolveRoleContract(root, "evidence-developer")).version).toBe("1.0.0");

  const promotedAt = Date.parse(activated.promotedAt);
  const effect = {
    schemaVersion: 1 as const,
    protocolId: protocolPlan.plan.protocolId,
    patternId: candidate.patternId,
    requestDigest: sha256("agent-profile effect treatment"),
    adapter: descriptor,
    treatmentWindow: {
      startedAt: new Date(promotedAt + 1_000).toISOString(),
      endedAt: new Date(promotedAt + 2_000).toISOString(),
    },
    treatment: [metric(9)],
    observedAt: new Date(promotedAt + 3_000).toISOString(),
  };
  const effectPath = resolve(root, ".lervo/profile-effect.json");
  await writeFile(effectPath, `${JSON.stringify(effect)}\n`);
  output.length = 0;
  expect(
    await runCli(["knowledge", "pattern", "effect", "observe", "--from", effectPath, "--json"], io),
  ).toBe(0);
  const effectPlan = JSON.parse(output.pop()!) as {
    plan: { planId: string; attribution: string; overall: string };
  };
  expect(effectPlan.plan).toMatchObject({
    attribution: "unestablished",
    overall: "favorable_observation",
  });
  expect(
    await runCli(
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
    ),
  ).toBe(0);

  output.length = 0;
  expect(await runCli(["role", "candidate", "rollback", candidate.patternId, "--json"], io)).toBe(
    0,
  );
  const rollbackPlan = JSON.parse(output.pop()!) as { planId: string; status: string };
  expect(rollbackPlan.status).toBe("ready");
  expect(
    await runCli(
      [
        "role",
        "candidate",
        "rollback",
        candidate.patternId,
        "--apply",
        "--approval",
        rollbackPlan.planId,
      ],
      io,
    ),
  ).toBe(0);
  await expect(resolveRoleContract(root, "evidence-developer")).rejects.toMatchObject({
    code: "role_not_found",
  });
  output.length = 0;
  expect(await runCli(["role", "candidate", "status", candidate.patternId, "--json"], io)).toBe(0);
  expect(JSON.parse(output.pop()!).patterns[0]).toMatchObject({
    state: "rolled_back",
    targetKind: "agent_profile",
    activatedRoleId: "evidence-developer",
  });
  expect(errors).toEqual([]);
  expect(
    JSON.parse(
      await readFile(
        resolve(root, ".lervo/state/knowledge/improvement-effects/current.json"),
        "utf8",
      ),
    ).effects,
  ).toHaveLength(1);
});
