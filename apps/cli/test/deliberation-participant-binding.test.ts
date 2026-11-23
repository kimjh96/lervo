import {
  deliberationExecutionRouteHash,
  selectionRoutedDeliberationRouteHash,
  deliberationParticipationAssignmentId,
  organizationIdentityHash,
  projectAgentOrganizationFromEventSource,
  workforceProviderPolicyHash,
} from "@lervo/agent-organization";
import { defaultEnglishWritingContract } from "@lervo/core";
import { deliberationPolicyHash } from "@lervo/deliberation";
import { openProjectStorage } from "@lervo/project-storage";
import { resolveRoleContract, roleProfileHash } from "@lervo/roles";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendOrganizationEvent,
  organizationPolicyHash,
} from "../src/agent-organization-event-mutation.js";
import { createFailedOutcome } from "../src/deliberation-contract.js";
import {
  bindAssignedDeliberationParticipants,
  releaseAssignedDeliberationParticipants,
} from "../src/deliberation-participant-binding.js";
import { createInlineDeliberationExecutionPlan } from "../src/deliberation-roles.js";
import {
  cleanupManagedDeliberationFixtures,
  repository,
} from "./managed-deliberation-test-fixture.js";

afterEach(cleanupManagedDeliberationFixtures);

const hash = (value: string) => `sha256:${value.repeat(64)}`;

describe("assigned deliberation participant binding", () => {
  it("separates the policy seat from the exact accepted agent role and execution route", async () => {
    const root = await repository();
    const storage = await openProjectStorage(root);
    const plan = createInlineDeliberationExecutionPlan({
      projectId: storage.manifest.projectId,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      writingContract: defaultEnglishWritingContract,
    });
    const proposer = plan.proposer;
    const providerPolicyHash = workforceProviderPolicyHash("codex");
    const common = {
      organizationId: "org_lervoowner01",
      teamId: "team_project001",
      projectId: storage.manifest.projectId,
    } as const;
    const membershipId = "amem_0123456789abcdef0123456789abcdef01234567";
    const deploymentId = "adep_0123456789abcdef0123456789abcdef01234567";
    const channelMembershipId = "cmem_0123456789abcdef0123456789abcdef01234567";
    const agentId = "agt_0123456789abcdef01234567";
    const participantId = "ptc_ruen_agent01";
    appendOrganizationEvent(storage, "organization.team.bound", {
      ...common,
      repositoryIdentityHash: hash("1"),
      organizationPolicyHash,
      teamPolicyHash: organizationIdentityHash({ projectId: storage.manifest.projectId }),
      teamKind: "project",
      boundAt: "2026-09-18T00:00:00.000Z",
    });
    const roleContract = await resolveRoleContract(root, "developer");
    const role = {
      roleId: roleContract.roleId,
      roleVersion: roleContract.version,
      roleContractHash: roleContract.contractHash,
      roleProfileHash: roleProfileHash(roleContract.definition.profile),
      providerPolicyHash,
    };
    appendOrganizationEvent(storage, "organization.agent.membership.changed", {
      ...common,
      membershipId,
      agentId,
      agentDisplayName: "Ruen",
      agentDisplayNameSource: "explicit",
      displayNameRevision: 1,
      ...role,
      previousStatus: null,
      status: "active",
      revision: 1,
      changedAt: "2026-09-18T00:00:01.000Z",
    });
    appendOrganizationEvent(storage, "organization.external_agent.deployment.bound", {
      ...common,
      deploymentId,
      membershipId,
      agentId,
      agentDisplayName: "Ruen",
      agentDisplayNameSource: "explicit",
      displayNameRevision: 1,
      participantId,
      ...role,
      platform: "discord",
      integrationId: "itg_discord_ruen01",
      externalPrincipalHash: hash("4"),
      deploymentConfigHash: hash("5"),
      boundAt: "2026-09-18T00:00:02.000Z",
    });
    appendOrganizationEvent(storage, "organization.channel.membership.changed", {
      ...common,
      channelMembershipId,
      deploymentId,
      membershipId,
      agentId,
      participantId,
      platform: "discord",
      integrationId: "itg_discord_ruen01",
      tenantKeyHash: hash("6"),
      conversationKeyHash: hash("7"),
      conversationId: "cnv_cli_deliberation",
      previousStatus: null,
      status: "active",
      revision: 1,
      changedAt: "2026-09-18T00:00:03.000Z",
    });

    const executionRouteHash = deliberationExecutionRouteHash({
      participantId,
      integrationId: "itg_discord_ruen01",
      provider: "codex",
      model: "gpt-6-astra",
      reasoningEffort: "high",
    });
    const participationAssignmentId = deliberationParticipationAssignmentId({
      deliberationId: "dlb_queue0001",
      policyId: plan.policy.policyId,
      policyRoleId: proposer.role.roleId,
      agentId,
      executionRouteHash,
    });
    const assignment = {
      schemaVersion: 1 as const,
      ...common,
      participationAssignmentId,
      deliberationId: "dlb_queue0001",
      policyId: plan.policy.policyId,
      policyRoleId: proposer.role.roleId,
      projectId: storage.manifest.projectId,
      conversationId: "cnv_cli_deliberation",
      channelMembershipId,
      membershipId,
      deploymentId,
      agentId,
      participantId,
      agentRoleId: role.roleId,
      roleVersion: role.roleVersion,
      roleContractHash: role.roleContractHash,
      roleProfileHash: role.roleProfileHash,
      providerPolicyHash,
      provider: "codex" as const,
      model: "gpt-6-astra",
      reasoningEffort: "high" as const,
      executionRouteHash,
      acceptedAt: "2026-09-18T00:00:04.000Z",
    };
    await expect(
      bindAssignedDeliberationParticipants({
        storage,
        deliberationId: "dlb_queue0001",
        plan,
        assignments: [
          {
            ...assignment,
            executionRouteHash: hash("8"),
          },
        ],
      }),
    ).rejects.toThrowError("The explicit deliberation participant assignment is not executable.");
    // ADR-0612 M2c: only the selection marker frees the model; a configured seat's hash with no
    // model or effort still pins both, so it never runs a model it was not accepted with.
    const unpinned = deliberationExecutionRouteHash({
      participantId,
      integrationId: "itg_discord_ruen01",
      provider: "codex",
      model: null,
      reasoningEffort: null,
    });
    await expect(
      bindAssignedDeliberationParticipants({
        storage,
        deliberationId: "dlb_queue0001",
        plan,
        assignments: [
          {
            ...assignment,
            executionRouteHash: unpinned,
            participationAssignmentId: deliberationParticipationAssignmentId({
              deliberationId: "dlb_queue0001",
              policyId: plan.policy.policyId,
              policyRoleId: proposer.role.roleId,
              agentId,
              executionRouteHash: unpinned,
            }),
          },
        ],
      }),
    ).rejects.toThrowError("The explicit deliberation participant assignment is not executable.");
    const executions = await bindAssignedDeliberationParticipants({
      storage,
      deliberationId: "dlb_queue0001",
      plan,
      assignments: [assignment],
    });
    expect(executions.get(proposer.role.roleId)).toEqual({
      agentId,
      participantId,
      provider: "codex",
      model: "gpt-6-astra",
      reasoningEffort: "high",
      executionRouteHash,
      role: roleContract.definition.profile,
    });
    expect(
      storage.events
        .list({ limit: 1_000 })
        .find((event) => event.type === "organization.deliberation.participant.bound")?.payload,
    ).toMatchObject({
      roleId: proposer.role.roleId,
      agentRoleId: "developer",
      roleVersion: role.roleVersion,
      roleContractHash: role.roleContractHash,
      roleProfileHash: role.roleProfileHash,
      providerPolicyHash,
    });

    const active = projectAgentOrganizationFromEventSource({
      projectId: storage.manifest.projectId,
      events: storage.events,
    });
    expect(active.deliberationParticipants).toEqual([
      expect.objectContaining({
        deliberationId: "dlb_queue0001",
        roleId: proposer.role.roleId,
        policyRoleId: proposer.role.roleId,
        agentRoleId: "developer",
        agentId,
        participantId,
        deliberationPolicyHash: deliberationPolicyHash(plan.policy),
        executionRouteHash,
        releasedAt: null,
      }),
    ]);
    await expect(
      bindAssignedDeliberationParticipants({
        storage,
        deliberationId: "dlb_queue0001",
        plan,
      }),
    ).rejects.toThrowError(
      "Resuming named deliberation participants requires their accepted routes.",
    );

    const outcome = createFailedOutcome({
      deliberationId: "dlb_queue0001",
      policy: plan.policy,
      history: [],
      completedAt: "2026-09-18T00:00:05.000Z",
      unresolvedBlockingObjectionIds: [],
      code: "fixture_failure",
    });
    releaseAssignedDeliberationParticipants({
      storage,
      outcome,
      releasedAt: "2026-09-18T00:00:06.000Z",
    });
    const released = projectAgentOrganizationFromEventSource({
      projectId: storage.manifest.projectId,
      events: storage.events,
    });
    expect(released.deliberationParticipants[0]).toMatchObject({
      releasedAt: "2026-09-18T00:00:06.000Z",
      outcomeId: outcome.outcomeId,
      outcomeStatus: "failed",
    });
    // A seat the selection routes binds its provider with the marker and runs the model the
    // assignment carries.
    const marker = selectionRoutedDeliberationRouteHash({
      participantId,
      integrationId: "itg_discord_ruen01",
      provider: "codex",
    });
    const routed = await bindAssignedDeliberationParticipants({
      storage,
      deliberationId: "dlb_queue0002",
      plan,
      assignments: [
        {
          ...assignment,
          deliberationId: "dlb_queue0002",
          model: "gpt-7-selected",
          reasoningEffort: "max",
          executionRouteHash: marker,
          participationAssignmentId: deliberationParticipationAssignmentId({
            deliberationId: "dlb_queue0002",
            policyId: plan.policy.policyId,
            policyRoleId: proposer.role.roleId,
            agentId,
            executionRouteHash: marker,
          }),
        },
      ],
    });
    expect(routed.get(proposer.role.roleId)).toMatchObject({
      provider: "codex",
      model: "gpt-7-selected",
      reasoningEffort: "max",
      executionRouteHash: marker,
    });
    await storage.close();
  });
});
