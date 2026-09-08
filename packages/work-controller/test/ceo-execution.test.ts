import type {
  CeoCommandRequest,
  CeoPolicy,
  OrganizationExecutiveEffect,
  OrganizationExecutiveEffectReceipt,
  OrganizationExecutiveEffectReplayPort,
} from "@lervo/application-contract";
import { describe, expect, it, vi } from "vitest";

import {
  calculateOrganizationExecutiveEffectHash,
  calculateOrganizationExecutiveParametersHash,
  createOrganizationOperatingReport,
  executeOrganizationExecutiveCommand,
} from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const appointedAgentId = `agt_${"a".repeat(24)}`;
const organizationId = "org_lervoowner01";
const teamId = "team_lervocore01";

const organization = createOrganizationOperatingReport({
  organizationId,
  teams: [
    {
      organizationId,
      teamId,
      teamKind: "central",
      projectId: "prj_lervocore01",
      repositoryIdentityHash: hash("1"),
      membershipCounts: { active: 1, suspended: 0, ended: 0 },
      deploymentCounts: { active: 1, retired: 0 },
      activeChannelMembershipCount: 1,
      activeDeliberationCount: 0,
      activeAgentContextEntryCount: 2,
      currentWorkstream: null,
      sourceHeadSequence: 20,
    },
  ],
});

const policy: CeoPolicy = {
  schemaVersion: 1,
  policyId: "ceop_lervoowner01",
  organizationId,
  appointedAgentId,
  allowedActions: ["conversation.channel.create"],
  approvalRequiredActions: [],
  allowedTeamIds: [teamId],
  maximumAutomationDepth: 2,
  budgetPolicyHash: hash("b"),
};

function effect(name = "architecture"): OrganizationExecutiveEffect {
  const parameters = { guildId: "1546479354773508176", name };
  return {
    schemaVersion: 1,
    effectId: "ceoe_createchannel01",
    organizationId,
    teamId,
    action: "conversation.channel.create",
    adapterId: "discord_administration_v1",
    parameters,
    parametersHash: hashParameters(parameters),
  };
}

function hashParameters(value: unknown): string {
  return calculateOrganizationExecutiveParametersHash(value);
}

function replay(): OrganizationExecutiveEffectReplayPort {
  return {
    begin: async () => ({ status: "reserved" }),
    complete: async () => undefined,
    markUnknown: async () => undefined,
    markRejected: async () => undefined,
  };
}

function request(boundEffect: OrganizationExecutiveEffect): CeoCommandRequest {
  return {
    schemaVersion: 1,
    requestId: "ceor_createchannel01",
    organizationId,
    requestedByAgentId: appointedAgentId,
    action: boundEffect.action,
    teamId,
    risk: "low",
    automationDepth: 1,
    budget: { status: "within", policyHash: hash("b") },
    approvalId: null,
    effectHash: calculateOrganizationExecutiveEffectHash(boundEffect),
  };
}

describe("CEO effect execution", () => {
  it("executes only the exact policy-approved and hash-bound adapter effect", async () => {
    const commandEffect = effect();
    const adapter = {
      adapterId: "discord_administration_v1",
      actions: ["conversation.channel.create" as const],
      apply: vi.fn(async () => ({
        status: "completed" as const,
        externalEffectId: "1547000000000000000",
        resultHash: hash("c"),
        completedAt: "2026-09-09T00:00:01.000Z",
      })),
    };
    const result = await executeOrganizationExecutiveCommand({
      policy,
      request: request(commandEffect),
      organization,
      effect: commandEffect,
      adapter,
      replay: replay(),
      now: () => new Date("2026-09-09T00:00:00.000Z"),
    });
    expect(result).toMatchObject({
      status: "completed",
      receipt: { externalEffectId: "1547000000000000000" },
    });
    expect(adapter.apply).toHaveBeenCalledTimes(1);
  });

  it("rejects a substituted payload before credentials or effects are used", async () => {
    const approved = effect("architecture");
    const substituted = effect("private-data");
    const adapter = {
      adapterId: "discord_administration_v1",
      actions: ["conversation.channel.create" as const],
      apply: vi.fn(),
    };
    await expect(
      executeOrganizationExecutiveCommand({
        policy,
        request: request(approved),
        organization,
        effect: substituted,
        adapter,
        replay: replay(),
      }),
    ).rejects.toThrow("does not bind the exact effect");
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it("never retries an unresolved external effect", async () => {
    const commandEffect = effect();
    const begin = vi.fn(async () => ({ status: "unknown" as const }));
    const adapter = {
      adapterId: "discord_administration_v1",
      actions: ["conversation.channel.create" as const],
      apply: vi.fn(),
    };
    const result = await executeOrganizationExecutiveCommand({
      policy,
      request: request(commandEffect),
      organization,
      effect: commandEffect,
      adapter,
      replay: { ...replay(), begin },
    });
    expect(result).toMatchObject({ status: "uncertain" });
    expect(adapter.apply).not.toHaveBeenCalled();
  });

  it("returns a previously verified receipt without applying the effect twice", async () => {
    const commandEffect = effect();
    const commandRequest = request(commandEffect);
    const decisionHash = (
      await executeOrganizationExecutiveCommand({
        policy,
        request: commandRequest,
        organization,
        effect: commandEffect,
        adapter: {
          adapterId: "discord_administration_v1",
          actions: ["conversation.channel.create"],
          apply: async () => ({
            status: "completed",
            externalEffectId: "1547000000000000000",
            resultHash: hash("c"),
            completedAt: "2026-09-09T00:00:01.000Z",
          }),
        },
        replay: replay(),
      })
    ).decision.decisionHash;
    const receipt: OrganizationExecutiveEffectReceipt = {
      schemaVersion: 1,
      effectId: commandEffect.effectId,
      requestId: commandRequest.requestId,
      decisionHash,
      effectHash: commandRequest.effectHash!,
      adapterId: commandEffect.adapterId,
      externalEffectId: "1547000000000000000",
      resultHash: hash("c"),
      completedAt: "2026-09-09T00:00:01.000Z",
    };
    const adapter = {
      adapterId: "discord_administration_v1",
      actions: ["conversation.channel.create" as const],
      apply: vi.fn(),
    };
    const result = await executeOrganizationExecutiveCommand({
      policy,
      request: commandRequest,
      organization,
      effect: commandEffect,
      adapter,
      replay: { ...replay(), begin: async () => ({ status: "completed", receipt }) },
    });
    expect(result.status).toBe("replayed");
    expect(adapter.apply).not.toHaveBeenCalled();
  });
});
