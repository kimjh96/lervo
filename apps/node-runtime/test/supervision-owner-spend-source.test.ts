import { createHash } from "node:crypto";
import type { OperatingActionPlanV1, OperatingMandateV3 } from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  managedExecutionIdentity,
  operatingContractHash,
  operatingDecisionId,
} from "@lervo/work-controller";
import { expect, it } from "vitest";
import {
  plan as fixturePlan,
  mandate as fixtureMandate,
} from "../../../packages/work-controller/test/operating-supervision.fixture.js";
import {
  readOwnerSpendAdmission,
  readOwnerSpendHeadroom,
} from "../src/supervision-owner-spend-source.js";

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const anchorId = `evt_${"b".repeat(32)}`;
const anchorHash = hash("b");

function setup(count: number) {
  const base = fixtureMandate();
  const mandate: OperatingMandateV3 = {
    ...base,
    schemaVersion: 3,
    maximumAttemptTokens: 100_000,
    maximumAggregateTokens: 200_000,
    executionAuthority: { schemaVersion: 1, mode: "designated_host", hostIdentityHash: hash("a") },
    workScope: {
      schemaVersion: 1,
      workstreamId: fixturePlan().workstreamId,
      snapshotEventId: `evt_${"a".repeat(32)}`,
      snapshotEventHash: hash("a"),
      excludedAssignments: [],
    },
    ownerSpendAllowance: {
      schemaVersion: 1,
      mode: "incremental_reservation",
      projectId: base.projectIds[0]!,
      anchorEventId: anchorId,
      anchorEventHash: anchorHash,
      maximumReservedTokens: 200_000,
    },
  };
  const bytes = new Map<string, Uint8Array>();
  const artifacts = {
    get: async (uri: string) => {
      const result = bytes.get(uri);
      if (result === undefined) throw new Error("missing artifact");
      return result;
    },
  } as ArtifactStore;
  const events = [
    {
      eventId: anchorId,
      eventHash: anchorHash,
      seq: 1,
      type: "work.supervision.mandate.revoked",
      projectId: base.projectIds[0],
      payload: { ownerAgentId: base.ownerAgentId },
    } as unknown as EventEnvelope,
  ];
  const plans: OperatingActionPlanV1[] = [];
  for (let index = 0; index < count; index++) {
    const recorded: OperatingActionPlanV1 = {
      ...fixturePlan(),
      supervisionId: `supervision.owner.${index}`,
      workstreamId: `wks_${String(index + 1).repeat(24)}`,
      mandateHash: operatingContractHash(mandate),
      actionKind: "execute_as_owner",
      effectContract: "work.owner_reasoning.v1",
      effectHash: hash(String(index + 1)),
      reservedTokens: 100_000,
    };
    plans.push(recorded);
    const content = new TextEncoder().encode(canonicalJson(recorded));
    const artifactHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    bytes.set(`lervo-cas://sha256/${artifactHash.slice(7)}`, content);
    events.push({
      eventId: `evt_${String(index + 1).repeat(32)}`,
      eventHash: hash(String(index + 1)),
      seq: index + 2,
      type: "work.supervision.decision.recorded",
      projectId: recorded.projectId,
      payload: {
        ownerAgentId: recorded.ownerAgentId,
        workstreamId: recorded.workstreamId,
        mandateHash: recorded.mandateHash,
        planArtifactHash: artifactHash,
        planHash: operatingContractHash(recorded),
        decisionId: operatingDecisionId(recorded),
      },
    } as unknown as EventEnvelope);
  }
  return { mandate, plans, artifacts, events };
}

it("charges earlier successor decisions against the same exact revocation epoch", async () => {
  const source = setup(2);
  expect(await readOwnerSpendAdmission({ ...source, plan: source.plans[1]! })).toEqual({
    disposition: "within",
    reservedTokens: 200_000,
    remainingTokens: 0,
  });
  const exceeded = setup(3);
  expect(await readOwnerSpendAdmission({ ...exceeded, plan: exceeded.plans[2]! })).toEqual({
    disposition: "exceeded",
    reservedTokens: 300_000,
    remainingTokens: 0,
  });
});

it("rejects a changed anchor, missing current decision and corrupt plan evidence", async () => {
  const source = setup(1);
  await expect(
    readOwnerSpendAdmission({
      ...source,
      plan: source.plans[0]!,
      mandate: {
        ...source.mandate,
        ownerSpendAllowance: { ...source.mandate.ownerSpendAllowance!, anchorEventHash: hash("f") },
      },
    }),
  ).rejects.toThrow(/anchor/u);
  await expect(
    readOwnerSpendAdmission({
      ...source,
      plan: { ...source.plans[0]!, effectHash: hash("f") },
    }),
  ).rejects.toThrow(/omits/u);
  await expect(
    readOwnerSpendAdmission({
      ...source,
      plan: source.plans[0]!,
      events: source.events.map((event) =>
        event.type === "work.supervision.decision.recorded"
          ? { ...event, payload: { ...event.payload, planHash: hash("f") } }
          : event,
      ),
    }),
  ).rejects.toThrow(/differs/u);
});

it("blocks a successor after an observed owner overrun without refunding the first reservation", async () => {
  const source = setup(2);
  const prior = source.plans[0]!;
  const runId = managedExecutionIdentity(prior.projectId, operatingContractHash(prior)).runId;
  source.events.push({
    eventId: `evt_${"f".repeat(32)}`,
    eventHash: hash("f"),
    seq: 4,
    schemaVersion: 3,
    type: "resource.usage.recorded",
    projectId: prior.projectId,
    runId,
    actor: { kind: "provider", provider: prior.provider },
    payload: {
      workId: `wrk_${"f".repeat(24)}`,
      resourceObservationId: `ruo_${"f".repeat(24)}`,
      sourceCoordinateDigest: hash("f"),
      scope: "primary_provider",
      source: "provider_reported",
      accountingMode: "turn_cumulative",
      accountingDescriptorHash: hash("e"),
      status: "observed",
      reasonCode: null,
      modelIdentity: {
        provider: prior.provider,
        requestedModel: "fixture",
        answerModel: "fixture",
        observedModelIds: ["fixture"],
        answerModelEvidence: "thread_start",
        unavailableReason: null,
      },
      usage: {
        inputTokens: 100_001,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 100_001,
        contextWindow: 200_000,
      },
    },
  } as unknown as EventEnvelope);
  expect(await readOwnerSpendAdmission({ ...source, plan: source.plans[1]! })).toMatchObject({
    disposition: "exceeded",
  });
});

it("reports proposal headroom from the same epoch before any decision is recorded", async () => {
  const one = setup(1);
  const scope = one.plans[0]!;
  expect(await readOwnerSpendHeadroom({ ...one, scope, nextReservedTokens: 100_000 })).toBe(true);
  const full = setup(2);
  expect(
    await readOwnerSpendHeadroom({ ...full, scope: full.plans[0]!, nextReservedTokens: 1 }),
  ).toBe(false);
  expect(
    await readOwnerSpendHeadroom({
      ...one,
      scope,
      mandate: (({ ownerSpendAllowance: _omitted, ...rest }) => rest)(one.mandate),
      nextReservedTokens: 100_000,
    }),
  ).toBeNull();
});
