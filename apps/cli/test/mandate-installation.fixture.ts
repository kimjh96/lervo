import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { OperatingMandateV1 } from "@lervo/application-contract";
import { registerAgent } from "@lervo/agent-workforce";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import {
  applyEventWriterActivationPlan,
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
} from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { runCli } from "../src/main.js";

export const hash = (letter = "a") => `sha256:${letter.repeat(64)}`;
export const supervisionId = "supervision.project";

export async function installationFixture(
  roots: string[],
  prepareRoot?: (root: string) => Promise<void>,
  roleId = "developer",
  projectId = `prj_${"a".repeat(16)}`,
) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-mandate-install-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId }));
  await prepareRoot?.(root);
  const evidence = {
    schemaVersion: 1 as const,
    projectId,
    observedAt: new Date().toISOString(),
    readers: [
      {
        readerId: "reader_local_runtime",
        readerKind: "local" as const,
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const activation = await planEventWriterActivation({
    repositoryRoot: root,
    evidence,
    targetEventSchemaVersion: 3,
  });
  await applyEventWriterActivationPlan({
    plan: activation,
    approval: activation.planId,
    currentEvidence: evidence,
  });
  const output: string[] = [];
  const errors: string[] = [];
  const draft = JSON.stringify({
    schemaVersion: 1,
    status: "active",
    title: "Mandate installation",
    objective: "Install exact reviewed local operating authority.",
    nextActions: ["Review the mandate."],
    blockers: [],
    notes: [],
    references: [],
    updatedAt: new Date().toISOString(),
  });
  const io = {
    cwd: root,
    stdout: (text: string) => output.push(text),
    stderr: (text: string) => errors.push(text),
    stdin: async () => draft,
  };
  if ((await runCli(["workstream", "start", "--stdin", "--json"], io)) !== 0)
    throw new Error(errors.join(""));
  const start = JSON.parse(output.join(""));
  if (
    (await runCli(["workstream", "start", "--stdin", "--apply", start.planId, "--json"], io)) !== 0
  )
    throw new Error(errors.join(""));
  const owner = await registerAgent({
    repositoryRoot: root,
    roleId,
    provider: "codex",
    responsibilityPaths: ["src"],
  });
  const storage = await openProjectStorage(root);
  try {
    const append = (
      letter: string,
      type: "organization.team.bound" | "organization.agent.membership.changed",
      payload: Record<string, unknown>,
    ) =>
      storage.events.append({
        eventId: `evt_${letter.repeat(32)}`,
        projectId,
        runId: "run_mandate_fixture",
        sessionId: "ses_mandate_fixture",
        type,
        schemaVersion: 2,
        occurredAt: new Date().toISOString(),
        policyVersion: hash(),
        actor: { kind: "system" },
        payload,
      });
    append("a", "organization.team.bound", {
      organizationId: "org_mandate01",
      teamId: "team_mandate01",
      projectId,
      repositoryIdentityHash: hash(),
      organizationPolicyHash: hash(),
      teamPolicyHash: hash(),
      teamKind: "project",
      boundAt: new Date().toISOString(),
    });
    append("b", "organization.agent.membership.changed", {
      membershipId: "amem_mandate01",
      organizationId: "org_mandate01",
      teamId: "team_mandate01",
      projectId,
      agentId: owner.agentId,
      roleId: owner.roleId,
      roleVersion: owner.roleVersion,
      roleContractHash: owner.roleContractHash,
      roleProfileHash: owner.roleProfileHash,
      providerPolicyHash: hash(),
      previousStatus: null,
      status: "active",
      revision: 1,
      changedAt: new Date().toISOString(),
    });
  } finally {
    await storage.close();
  }
  const mandate: OperatingMandateV1 = {
    schemaVersion: 1,
    mandateId: "mandate.project",
    version: 1,
    appointingAuthorityId: "user.founder",
    ownerAgentId: owner.agentId,
    projectIds: [projectId],
    teamIds: ["team_mandate01"],
    actionKinds: ["allocate_existing", "dispatch"],
    roleIds: [roleId],
    capabilityCeiling: ["filesystem.read", "filesystem.write"],
    pathRoots: ["src"],
    providers: ["codex"],
    maximumWorkers: 4,
    maximumConcurrentAttempts: 2,
    maximumAttemptsPerAssignment: 3,
    maximumAttemptTokens: 1000,
    maximumAggregateTokens: 10000,
    maximumDeadlineMs: 3600000,
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    revocationCoordinate: "mandate.project.revocation",
  };
  return { root, owner, mandate };
}
