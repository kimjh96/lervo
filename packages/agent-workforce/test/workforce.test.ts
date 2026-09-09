import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  hashCapabilityFiles,
  installCapabilityPackage,
  readCapabilityPackage,
} from "@lervo/capabilities";
import type { CapabilityPackageManifest } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  cancelAssignment,
  changeAgentDisplayName,
  changeAgentRole,
  changeAgentStatus,
  claimAssignment,
  completeAssignment,
  createAssignment,
  createAssignmentCancellationPlan,
  listAgents,
  listAssignments,
  recordAssignmentHandoff,
  reconcileAssignmentCompletion,
  registerAgent,
  renewAssignmentLease,
} from "../src/index.js";

const roots: string[] = [];
const execute = promisify(execFile);

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workforce-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_agent_workforce_01",
      now: new Date("2026-08-25T00:00:00.000Z"),
    }),
  );
  return root;
}

async function installCapability(root: string, capabilityId: string): Promise<void> {
  const source = resolve(root, `.fixture-${capabilityId.replaceAll("/", "-")}`);
  await mkdir(source);
  const payload = new TextEncoder().encode("{}\n");
  await writeFile(resolve(source, "configuration.schema.json"), payload);
  const runtime = new TextEncoder().encode(
    JSON.stringify({
      schemaVersion: 1,
      serverName: capabilityId.replaceAll("/", "-"),
      transport: {
        kind: "stdio",
        command: "node",
        entrypointPath: "server.mjs",
        arguments: [],
        timeoutMs: 5000,
      },
    }),
  );
  await writeFile(resolve(source, "lervo-mcp.json"), runtime);
  const server = new TextEncoder().encode("process.stdin.resume();\n");
  await writeFile(resolve(source, "server.mjs"), server);
  const manifest: CapabilityPackageManifest = {
    schemaVersion: 1,
    capabilityId,
    kind: "mcp_server",
    version: "1.0.0",
    contentHash: hashCapabilityFiles([
      { path: "configuration.schema.json", bytes: payload },
      { path: "lervo-mcp.json", bytes: runtime },
      { path: "server.mjs", bytes: server },
    ]),
    source: {
      kind: "project",
      uri: `fixture:${capabilityId}`,
      publisher: { id: "publisher_test", name: "Test" },
    },
    compatibility: {
      providers: { mode: "any" },
      minimumRuntimeVersion: "0.1.0",
      platforms: ["darwin", "linux", "win32"],
    },
    requiredPermissions: [],
    dependencies: [],
    entrypoint: {
      kind: "mcp_server",
      adapterId: "mcp.test",
      configurationSchemaRef: "configuration.schema.json",
      runtimeDescriptorPath: "lervo-mcp.json",
      credentialNames: [],
    },
    activation: "explicit",
    publication: { defaultVisibility: "local", secretMaterial: "excluded" },
  };
  await writeFile(
    resolve(source, "lervo-capability.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await installCapabilityPackage({
    repositoryRoot: root,
    scope: "project",
    package: await readCapabilityPackage(source),
  });
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("repository agent workforce", () => {
  it("keeps a unique agent display identity separate from its role and provider", async () => {
    const root = await repository();
    const named = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "claude",
      displayName: "Nova",
    });
    const generated = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "codex",
    });
    expect(named).toMatchObject({
      displayName: "Nova",
      displayNameSource: "explicit",
      roleId: "developer",
      provider: "claude",
    });
    expect(generated.displayNameSource).toBe("generated");
    expect(generated.displayName).not.toBe("developer");
    const renamed = await changeAgentDisplayName({
      repositoryRoot: root,
      agentId: generated.agentId,
      expectedRevision: 1,
      displayName: "Sol",
    });
    expect(renamed).toMatchObject({
      displayName: "Sol",
      displayNameSource: "explicit",
      roleId: "developer",
      provider: "codex",
      revision: 2,
    });
    await expect(
      registerAgent({ repositoryRoot: root, roleId: "writer", displayName: "nova" }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
  });

  it("changes a suspended agent role without replacing its identity or context namespace", async () => {
    const root = await repository();
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const hired = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "any",
      displayName: "Tarin",
      recordEvent: (event) => {
        events.push(event);
      },
    });
    const suspended = await changeAgentStatus({
      repositoryRoot: root,
      agentId: hired.agentId,
      expectedRevision: 1,
      status: "suspended",
      recordEvent: (event) => {
        events.push(event);
      },
    });
    const rebound = await changeAgentRole({
      repositoryRoot: root,
      agentId: hired.agentId,
      expectedRevision: suspended.revision,
      roleId: "ceo",
      recordEvent: (event) => {
        events.push(event);
      },
    });

    expect(rebound).toMatchObject({
      agentId: hired.agentId,
      displayName: "Tarin",
      displayNameSource: "explicit",
      roleId: "ceo",
      roleVersion: "1.0.0",
      provider: "any",
      status: "suspended",
      revision: 3,
      createdAt: hired.createdAt,
    });
    expect(rebound.roleContractHash).not.toBe(hired.roleContractHash);
    expect(rebound.roleProfileHash).not.toBe(hired.roleProfileHash);
    expect(rebound.capabilityHash).not.toBe(hired.capabilityHash);
    expect(events.at(-1)).toMatchObject({
      type: "agent.identity.changed",
      payload: {
        changeKind: "role_binding",
        agentId: hired.agentId,
        previousDisplayName: "Tarin",
        displayName: "Tarin",
        previousRoleId: "developer",
        roleId: "ceo",
        revision: 3,
      },
    });
    const active = await changeAgentStatus({
      repositoryRoot: root,
      agentId: hired.agentId,
      expectedRevision: rebound.revision,
      status: "active",
    });
    await expect(
      changeAgentRole({
        repositoryRoot: root,
        agentId: hired.agentId,
        expectedRevision: active.revision,
        roleId: "developer",
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
  });

  it("shares one scheduler across sibling worktrees and rejects cross-worktree overlap", async () => {
    const root = await repository();
    await writeFile(resolve(root, "README.fixture.md"), "fixture\n");
    await execute("git", ["-C", root, "init"]);
    await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
    await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
    await execute("git", ["-C", root, "add", "."]);
    await execute("git", ["-C", root, "commit", "-m", "fixture"]);
    const sibling = await mkdtemp(resolve(tmpdir(), "lervo-workforce-sibling-"));
    roots.push(sibling);
    await rm(sibling, { recursive: true });
    await execute("git", ["-C", root, "worktree", "add", "--detach", sibling, "HEAD"]);

    const first = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      responsibilityPaths: ["src"],
    });
    const second = await registerAgent({
      repositoryRoot: sibling,
      roleId: "developer",
      responsibilityPaths: ["src"],
    });
    expect((await listAgents(sibling)).map((agent) => agent.agentId)).toEqual(
      [first.agentId, second.agentId].sort(),
    );
    const [alpha, overlap] = await Promise.all([
      createAssignment({
        repositoryRoot: root,
        taskType: "implementation",
        roleId: "developer",
        acceptanceCriteria: ["Alpha passes."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths: ["src"],
      }),
      createAssignment({
        repositoryRoot: sibling,
        taskType: "implementation",
        roleId: "developer",
        acceptanceCriteria: ["Overlap is rejected."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths: ["src/file.ts"],
      }),
    ]);
    await claimAssignment({
      repositoryRoot: root,
      assignmentId: alpha.assignmentId,
      agentId: first.agentId,
      sessionId: "ses_shared_root_001",
    });
    await expect(
      claimAssignment({
        repositoryRoot: sibling,
        assignmentId: overlap.assignmentId,
        agentId: second.agentId,
        sessionId: "ses_shared_sibling_01",
      }),
    ).rejects.toMatchObject({ code: "assignment_path_conflict" });
  });

  it("gives a repository-specialized researcher the full root, subagent, assignment, and concurrency lifecycle", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
    await writeFile(
      resolve(root, ".lervo/roles/legal-researcher.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "lervo_repository_role",
          roleId: "legal-researcher",
          version: "1.0.0",
          extends: [{ roleId: "researcher", version: "1.0.0" }],
          profile: {
            name: "Legal Researcher",
            description: "Researches legal sources under the inherited evidence contract.",
            requestTypes: ["legal.research"],
            handoff: {
              allowedRoleIds: ["writer"],
              evidenceLinksRequired: true,
              sharedContextRequired: true,
            },
          },
          checks: [],
        },
        null,
        2,
      )}\n`,
    );
    const parent = await registerAgent({
      repositoryRoot: root,
      roleId: "legal-researcher",
      responsibilityPaths: ["research/a"],
    });
    const child = await registerAgent({
      repositoryRoot: root,
      roleId: "legal-researcher",
      parentAgentId: parent.agentId,
      responsibilityPaths: ["research/b"],
    });
    expect(parent).toMatchObject({
      roleId: "legal-researcher",
      roleVersion: "1.0.0",
      roleContractHash: expect.stringMatching(/^sha256:/u),
    });
    expect(child).toMatchObject({
      parentAgentId: parent.agentId,
      delegationDepth: 1,
      roleContractHash: parent.roleContractHash,
    });
    const [alpha, beta] = await Promise.all([
      createAssignment({
        repositoryRoot: root,
        taskType: "legal.research",
        roleId: "legal-researcher",
        acceptanceCriteria: ["Alpha sources verified."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths: ["research/a"],
      }),
      createAssignment({
        repositoryRoot: root,
        taskType: "legal.research",
        roleId: "legal-researcher",
        acceptanceCriteria: ["Beta sources verified."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths: ["research/b"],
      }),
    ]);
    const [alphaLease, betaLease] = await Promise.all([
      claimAssignment({
        repositoryRoot: root,
        assignmentId: alpha.assignmentId,
        agentId: parent.agentId,
        sessionId: "ses_legal_parent_01",
      }),
      claimAssignment({
        repositoryRoot: root,
        assignmentId: beta.assignmentId,
        agentId: child.agentId,
        sessionId: "ses_legal_child_001",
      }),
    ]);
    expect(alphaLease.roleContractHash).toBe(parent.roleContractHash);
    expect(betaLease.roleContractHash).toBe(child.roleContractHash);
  });

  it("fails closed when a hired repository role changes contract bytes without a version change", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
    const path = resolve(root, ".lervo/roles/legal-researcher.json");
    const definition = {
      schemaVersion: 1,
      kind: "lervo_repository_role",
      roleId: "legal-researcher",
      version: "1.0.0",
      extends: [{ roleId: "researcher", version: "1.0.0" }],
      profile: { name: "Legal Researcher", description: "Researches legal sources." },
      checks: [],
    };
    await writeFile(path, `${JSON.stringify(definition, null, 2)}\n`);
    await registerAgent({ repositoryRoot: root, roleId: "legal-researcher" });
    await writeFile(
      path,
      `${JSON.stringify({ ...definition, profile: { name: "Legal Researcher", description: "Changed contract bytes." } }, null, 2)}\n`,
    );
    await expect(listAgents(root)).rejects.toMatchObject({ code: "agent_state_conflict" });
  });

  it("runs same-role agents concurrently on disjoint paths and rejects overlapping leases", async () => {
    const root = await repository();
    const [first, second] = await Promise.all([
      registerAgent({ repositoryRoot: root, roleId: "developer", responsibilityPaths: ["src/a"] }),
      registerAgent({ repositoryRoot: root, roleId: "developer", responsibilityPaths: ["src/b"] }),
    ]);
    const [alpha, beta, overlap] = await Promise.all([
      createAssignment({
        repositoryRoot: root,
        taskType: "implementation",
        roleId: "developer",
        acceptanceCriteria: ["Alpha passes."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths: ["src/a"],
      }),
      createAssignment({
        repositoryRoot: root,
        taskType: "implementation",
        roleId: "developer",
        acceptanceCriteria: ["Beta passes."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths: ["src/b"],
      }),
      createAssignment({
        repositoryRoot: root,
        taskType: "technical.review",
        roleId: "developer",
        acceptanceCriteria: ["Review passes."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths: ["src/a/file.ts"],
      }),
    ]);
    const [alphaLease, betaLease] = await Promise.all([
      claimAssignment({
        repositoryRoot: root,
        assignmentId: alpha.assignmentId,
        agentId: first.agentId,
        sessionId: "ses_alpha_agent_01",
      }),
      claimAssignment({
        repositoryRoot: root,
        assignmentId: beta.assignmentId,
        agentId: second.agentId,
        sessionId: "ses_beta_agent_001",
      }),
    ]);
    expect(alphaLease.status).toBe("leased");
    expect(betaLease.status).toBe("leased");
    await expect(
      claimAssignment({
        repositoryRoot: root,
        assignmentId: overlap.assignmentId,
        agentId: first.agentId,
        sessionId: "ses_overlap_agent1",
      }),
    ).rejects.toMatchObject({ code: "assignment_path_conflict" });
  });

  it("allows exactly one winner when agents race for one assignment", async () => {
    const root = await repository();
    const [first, second] = await Promise.all([
      registerAgent({ repositoryRoot: root, roleId: "developer" }),
      registerAgent({ repositoryRoot: root, roleId: "developer" }),
    ]);
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["Pass."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src"],
    });
    const results = await Promise.allSettled([
      claimAssignment({
        repositoryRoot: root,
        assignmentId: assignment.assignmentId,
        agentId: first.agentId,
        sessionId: "ses_racing_agent_1",
      }),
      claimAssignment({
        repositoryRoot: root,
        assignmentId: assignment.assignmentId,
        agentId: second.agentId,
        sessionId: "ses_racing_agent_2",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rejects a scheduler claim after the selected assignment revision changes", async () => {
    const root = await repository();
    const worker = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["Pass."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src"],
    });

    await expect(
      claimAssignment({
        repositoryRoot: root,
        assignmentId: assignment.assignmentId,
        expectedRevision: assignment.revision + 1,
        agentId: worker.agentId,
        sessionId: "ses_stale_scheduler_01",
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
    expect((await listAssignments(root))[0]).toMatchObject({ status: "queued", revision: 1 });
  });

  it("gives subagents the same claim, handoff, and completion behavior as root agents", async () => {
    const root = await repository();
    const parent = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "codex",
    });
    const child = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "claude",
      parentAgentId: parent.agentId,
    });
    const writer = await registerAgent({ repositoryRoot: root, roleId: "writer" });
    expect(child).toMatchObject({
      parentAgentId: parent.agentId,
      delegationDepth: 1,
      status: "active",
    });
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["Implementation verified."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src"],
    });
    const claimed = await claimAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      agentId: child.agentId,
      sessionId: "ses_child_agent_001",
    });
    const renewed = await renewAssignmentLease({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      agentId: child.agentId,
      leaseId: claimed.lease!.leaseId,
      leaseDurationMs: 10 * 60_000,
    });
    expect(Date.parse(renewed.lease!.expiresAt)).toBeGreaterThan(
      Date.parse(claimed.lease!.expiresAt),
    );
    const handed = await recordAssignmentHandoff({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      fromAgentId: child.agentId,
      toAgentId: writer.agentId,
      leaseId: renewed.lease!.leaseId,
      requestDigest: `sha256:${"a".repeat(64)}`,
      artifactReferences: [
        { artifactId: "art_handoff_artifact_01", contentHash: `sha256:${"b".repeat(64)}` },
      ],
      contextEvidenceEventIds: ["evt_context_evidence_01"],
    });
    expect(handed.handoffs[0]).toMatchObject({
      fromAgentId: child.agentId,
      toAgentId: writer.agentId,
    });
    const completed = await completeAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      agentId: child.agentId,
      leaseId: renewed.lease!.leaseId,
      resultArtifacts: [
        { artifactId: "art_result_artifact_001", contentHash: `sha256:${"c".repeat(64)}` },
      ],
      verificationStatus: "passed",
    });
    expect(completed).toMatchObject({
      status: "completed",
      assigneeAgentId: child.agentId,
      lease: null,
    });
    expect(await listAgents(root)).toHaveLength(3);
    expect(await listAssignments(root)).toHaveLength(1);
  });

  it("binds exact capability packages and lets subagents inherit or narrow without expanding authority", async () => {
    const root = await repository();
    await installCapability(root, "tools/research");
    await installCapability(root, "tools/extra");
    const parent = await registerAgent({
      repositoryRoot: root,
      roleId: "researcher",
      provider: "codex",
      capabilityPackageIds: ["tools/research"],
    });
    const inherited = await registerAgent({
      repositoryRoot: root,
      roleId: "researcher",
      provider: "codex",
      parentAgentId: parent.agentId,
    });
    const narrowed = await registerAgent({
      repositoryRoot: root,
      roleId: "researcher",
      provider: "codex",
      parentAgentId: parent.agentId,
      capabilityPackageIds: [],
    });
    expect(inherited.capabilityPackages).toEqual(parent.capabilityPackages);
    expect(narrowed.capabilityPackages).toEqual([]);
    await expect(
      registerAgent({
        repositoryRoot: root,
        roleId: "researcher",
        provider: "codex",
        parentAgentId: parent.agentId,
        capabilityPackageIds: ["tools/research", "tools/extra"],
      }),
    ).rejects.toMatchObject({ code: "agent_state_conflict" });
  });

  it("restores state when canonical event recording fails", async () => {
    const root = await repository();
    await expect(
      registerAgent({
        repositoryRoot: root,
        roleId: "researcher",
        recordEvent: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "workforce_write_failed" });
    expect(await listAgents(root)).toEqual([]);
  });

  it("cancels one exact planned assignment and requires cancelled dependency evidence", async () => {
    const root = await repository();
    const parent = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["Parent no longer required."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/parent"],
    });
    const dependent = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      dependencyIds: [parent.assignmentId],
      acceptanceCriteria: ["Dependent no longer required."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/dependent"],
    });
    expect(
      createAssignmentCancellationPlan({
        assignments: await listAssignments(root),
        assignmentId: dependent.assignmentId,
        reason: "dependency_cancelled",
      }),
    ).toMatchObject({ status: "blocked", blockedReason: "dependency_not_cancelled" });

    const parentPlan = createAssignmentCancellationPlan({
      assignments: await listAssignments(root),
      assignmentId: parent.assignmentId,
      reason: "requested",
    });
    const events: string[] = [];
    await cancelAssignment({
      repositoryRoot: root,
      assignmentId: parent.assignmentId,
      reason: "requested",
      expectedPlanId: parentPlan.planId,
      recordEvent: (event) => {
        events.push(event.type);
      },
    });
    const dependentPlan = createAssignmentCancellationPlan({
      assignments: await listAssignments(root),
      assignmentId: dependent.assignmentId,
      reason: "dependency_cancelled",
    });
    const cancelled = await cancelAssignment({
      repositoryRoot: root,
      assignmentId: dependent.assignmentId,
      reason: "dependency_cancelled",
      expectedPlanId: dependentPlan.planId,
      recordEvent: (event) => {
        events.push(event.type);
      },
    });
    expect(cancelled).toMatchObject({ status: "cancelled", revision: 2, lease: null });
    expect(events).toEqual(["assignment.cancelled", "assignment.cancelled"]);

    const rollbackTarget = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["Rollback remains queued."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/rollback"],
    });
    const rollbackPlan = createAssignmentCancellationPlan({
      assignments: await listAssignments(root),
      assignmentId: rollbackTarget.assignmentId,
      reason: "requested",
    });
    await expect(
      cancelAssignment({
        repositoryRoot: root,
        assignmentId: rollbackTarget.assignmentId,
        reason: "requested",
        expectedPlanId: rollbackPlan.planId,
        recordEvent: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "workforce_write_failed" });
    expect(
      (await listAssignments(root)).find(
        (assignment) => assignment.assignmentId === rollbackTarget.assignmentId,
      ),
    ).toMatchObject({ status: "queued", revision: 1 });
  });

  it("reconciles evidence prepared under an expired exact lease and rolls back event failure", async () => {
    const root = await repository();
    const agent = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["Recovered work is complete."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/recovered"],
    });
    const claimed = await claimAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      agentId: agent.agentId,
      sessionId: "ses_reconciliation_fixture",
      leaseDurationMs: 5_000,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    const reconcile = {
      repositoryRoot: root,
      assignmentId: claimed.assignmentId,
      assignmentRevision: claimed.revision,
      agentId: agent.agentId,
      leaseId: claimed.lease!.leaseId,
      resultArtifact: {
        artifactId: `art_${"a".repeat(64)}`,
        contentHash: `sha256:${"a".repeat(64)}`,
      },
      completionEvidenceId: `acp_${"b".repeat(24)}`,
      reconciliationCommandId: `gcr_${"c".repeat(24)}`,
      sourceRunId: "run_reconciliation_fixture",
      preparedAt: "2026-09-01T00:00:04.000Z",
      now: new Date("2026-09-01T00:01:00.000Z"),
    };
    await expect(
      reconcileAssignmentCompletion({
        ...reconcile,
        preparedAt: "2026-09-01T00:00:05.000Z",
      }),
    ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
    await expect(
      reconcileAssignmentCompletion({
        ...reconcile,
        recordEvent: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "workforce_write_failed" });
    expect(
      (await listAssignments(root)).find((item) => item.assignmentId === claimed.assignmentId),
    ).toMatchObject({ status: "leased", revision: claimed.revision });

    const events: string[] = [];
    const completed = await reconcileAssignmentCompletion({
      ...reconcile,
      recordEvent: (event) => {
        events.push(event.type);
      },
    });
    expect(completed).toMatchObject({ status: "completed", revision: claimed.revision + 1 });
    expect(events).toEqual(["assignment.completion.reconciled"]);
  });
});
