import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import type {
  OperatingActionPlanV1,
  SupervisedResultDeliveryV1,
} from "@lervo/application-contract";
import { registerAgent } from "@lervo/agent-workforce";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  operatingContractHash,
  operatingEffectAdmissionHash,
  reviewOperatingAction,
  supervisedResultDeliveryFields,
} from "@lervo/work-controller";
import { SupervisionResultDelivery } from "../src/supervision-result-delivery.js";
import { NodeSupervisionStore } from "../src/supervision-store.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { supervisionFixture } from "./supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("supersedes a stale publication only while its outbound remains unqueued", async () => {
  const f = await supervisionFixture(roots, undefined, "developer", ["publish_result"]);
  const storage = await openProjectStorage(f.root);
  const tasks = new SupervisionTaskSource(storage, f.binding, f.ports.now);
  const effect: SupervisedResultDeliveryV1 = {
    schemaVersion: 1,
    kind: "work.result_delivery",
    workstreamId: f.binding.workstreamId,
    ownerAgentId: f.binding.ownerAgentId,
    completionPlanHash: `sha256:${"1".repeat(64)}`,
    completionEventId: `evt_${"2".repeat(32)}`,
    resultArtifactHash: `sha256:${"3".repeat(64)}`,
    candidateArtifactHash: `sha256:${"4".repeat(64)}`,
    outboundArtifactHash: `sha256:${"5".repeat(64)}`,
    rationaleArtifactHash: `sha256:${"6".repeat(64)}`,
  };
  const effectArtifact = await storage.artifacts.put(canonicalJson(effect));
  expect(effectArtifact.contentHash).toBe(operatingContractHash(effect));
  const store = await NodeSupervisionStore.open({
    repositoryRoot: f.root,
    binding: f.binding,
    now: f.ports.now,
  });
  let plan: OperatingActionPlanV1 | null = null;
  try {
    await store.withOwner(async (session) => {
      const authority = await session.readAuthority();
      const source = await tasks.read();
      const sourceRevisionDigest = operatingContractHash({
        authorityDigest: authority.source.sourceRevisionDigest,
        taskDigest: source.sourceRevisionDigest,
      });
      plan = {
        schemaVersion: 1,
        ...f.binding,
        projectId: f.owner.projectId,
        teamId: f.mandate.teamIds[0]!,
        sourceRevisionDigest,
        graphHash: source.graph.graphHash,
        causationEventIds: [source.sourceEventId],
        ...supervisedResultDeliveryFields(effect),
        roleId: f.owner.roleId,
        provider: "codex",
        deadline: new Date(Date.now() + 60_000).toISOString(),
      };
      const review = reviewOperatingAction({
        mandate: authority.installation.mandate,
        plan,
        snapshot: {
          observedAt: f.ports.now(),
          sourceRevisionDigest,
          graphHash: plan.graphHash,
          installedMandateHash: f.binding.mandateHash,
          installationReviewHash: authority.installation.installationReviewHash,
          revocationCoordinate: authority.installation.mandate.revocationCoordinate,
          revoked: false,
          ancestryValid: true,
          historyValid: true,
          activeWorkers: 1,
          activeAttempts: 0,
          assignmentCount: source.assignments.length,
          observedAggregateTokens: 0,
          reservedAggregateTokens: 0,
          liveResponsibilityLease: false,
          resourceAdmission: "within",
          effectAdmissionHash: operatingEffectAdmissionHash(plan),
          effectMappings: [{ actionKind: "publish_result", contract: "work.result_delivery.v1" }],
        },
      });
      expect(review.disposition, review.reasonCodes.join(",")).toBe("admitted");
      await session.recordDecision(plan, review, authority.source.sourceRevisionDigest);
    });
  } finally {
    await store.close();
  }
  if (plan === null) throw new Error("The fixture publication plan was not recorded.");
  await registerAgent({
    repositoryRoot: f.root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["src"],
    parentAgentId: f.owner.agentId,
  });
  const recovery = await NodeSupervisionStore.open({
    repositoryRoot: f.root,
    binding: f.binding,
    now: f.ports.now,
  });
  const delivery = new SupervisionResultDelivery(
    storage,
    f.binding,
    {
      adapter: {
        descriptor: {
          schemaVersion: 1,
          integrationId: "itg_deliverysupersession",
          adapterKind: "discord",
          instanceIdentityHash: `sha256:${"7".repeat(64)}`,
          capabilities: ["messages.send"],
        },
        deliver: async () => {
          throw new Error("An unqueued delivery must not reach transport.");
        },
      },
    },
    f.ports.now,
  );
  try {
    await recovery.withOwner(async (session) => {
      const authority = await session.readAuthority();
      const source = await tasks.read();
      const currentDigest = operatingContractHash({
        authorityDigest: authority.source.sourceRevisionDigest,
        taskDigest: source.sourceRevisionDigest,
      });
      expect(await delivery.supersede(plan!, currentDigest, session)).toBe(true);
      expect(await session.findPendingPlan()).toBeNull();
    });
    const events = (await tasks.read()).events;
    expect(
      events.filter((event) => event.type === "work.supervision.decision.superseded"),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "work.supervision.delivery.queued"),
    ).toHaveLength(0);
  } finally {
    await recovery.close();
    await storage.close();
  }
});
