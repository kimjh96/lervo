import {
  organizationIdentityHash,
  projectAgentOrganizationFromEventSource,
  workforceProviderPolicyHash,
} from "@lervo/agent-organization";
import { defaultEnglishWritingContract } from "@lervo/core";
import { deliberationPolicyHash } from "@lervo/deliberation";
import { openProjectStorage } from "@lervo/project-storage";
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
  it("uses the exact channel-bound agent name and releases the seat at terminal outcome", async () => {
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
    appendOrganizationEvent(storage, "organization.team.bound", {
      ...common,
      repositoryIdentityHash: hash("1"),
      organizationPolicyHash,
      teamPolicyHash: organizationIdentityHash({ projectId: storage.manifest.projectId }),
      teamKind: "project",
      boundAt: "2026-09-18T00:00:00.000Z",
    });
    appendOrganizationEvent(storage, "organization.agent.membership.changed", {
      ...common,
      membershipId: "amem_0123456789abcdef0123456789abcdef01234567",
      agentId: "agt_0123456789abcdef01234567",
      agentDisplayName: "Ruen",
      agentDisplayNameSource: "explicit",
      displayNameRevision: 1,
      roleId: proposer.role.roleId,
      roleVersion: "1.0.0",
      roleContractHash: hash("2"),
      roleProfileHash: hash("3"),
      providerPolicyHash,
      previousStatus: null,
      status: "active",
      revision: 1,
      changedAt: "2026-09-18T00:00:01.000Z",
    });
    appendOrganizationEvent(storage, "organization.external_agent.deployment.bound", {
      ...common,
      deploymentId: "adep_0123456789abcdef0123456789abcdef01234567",
      membershipId: "amem_0123456789abcdef0123456789abcdef01234567",
      agentId: "agt_0123456789abcdef01234567",
      agentDisplayName: "Ruen",
      agentDisplayNameSource: "explicit",
      displayNameRevision: 1,
      participantId: "ptc_ruen_agent01",
      roleId: proposer.role.roleId,
      roleVersion: "1.0.0",
      roleContractHash: hash("2"),
      roleProfileHash: hash("3"),
      providerPolicyHash,
      platform: "discord",
      integrationId: "itg_discord_ruen01",
      externalPrincipalHash: hash("4"),
      deploymentConfigHash: hash("5"),
      boundAt: "2026-09-18T00:00:02.000Z",
    });
    appendOrganizationEvent(storage, "organization.channel.membership.changed", {
      ...common,
      channelMembershipId: "cmem_0123456789abcdef0123456789abcdef01234567",
      deploymentId: "adep_0123456789abcdef0123456789abcdef01234567",
      membershipId: "amem_0123456789abcdef0123456789abcdef01234567",
      agentId: "agt_0123456789abcdef01234567",
      participantId: "ptc_ruen_agent01",
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

    const boundPlan = bindAssignedDeliberationParticipants({
      storage,
      deliberationId: "dlb_queue0001",
      plan,
      conversationId: "cnv_cli_deliberation",
      boundAt: "2026-09-18T00:00:04.000Z",
    });
    expect(boundPlan.proposer.role.name).toBe("Ruen");
    expect(boundPlan.reviewers[0]?.role.name).toBe(plan.reviewers[0]?.role.name);

    const active = projectAgentOrganizationFromEventSource({
      projectId: storage.manifest.projectId,
      events: storage.events,
    });
    expect(active.deliberationParticipants).toEqual([
      expect.objectContaining({
        deliberationId: "dlb_queue0001",
        roleId: proposer.role.roleId,
        deliberationPolicyHash: deliberationPolicyHash(plan.policy),
        releasedAt: null,
      }),
    ]);

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
    expect(
      storage.events
        .list({ limit: 1_000 })
        .find((event) => event.type === "organization.deliberation.participant.released")
        ?.occurredAt,
    ).toBe("2026-09-18T00:00:06.000Z");
    await storage.close();
  });
});
