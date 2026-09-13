import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import type {
  OperatingActionPlanV1,
  ScopedWorkHandoffV1,
  ScopedWorkHandoffAcceptanceV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage, resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { listAssignments } from "@lervo/agent-workforce";
import { operatingContractHash, scopedHandoffFields } from "@lervo/work-controller";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionPeerSource } from "../src/supervision-peer-source.js";
import { SupervisionHandoffEffects } from "../src/supervision-handoff-effects.js";
import { SupervisionPeerCatalog } from "../src/supervision-peer-catalog.js";
import { NodeSupervisionStore } from "../src/supervision-store.js";
import { canonicalOwnerReasoningFacts } from "../src/supervision-reasoning-context.js";
import { nativeScopedHandoff } from "../src/supervision-native-handoff.js";
import { supervisionFixture } from "./supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["team_support", "central_escalation"] as const)(
  "materializes native proposals and records separate policy-admitted offer and successor acceptance (%s)",
  async (purpose) => {
    const sender = await supervisionFixture(roots, undefined, "developer", [
      "request_team_support",
      "escalate",
      "execute_as_owner",
    ]);
    const recipient = await supervisionFixture(
      roots,
      undefined,
      "developer",
      ["request_team_support", "escalate", "execute_as_owner"],
      undefined,
      `prj_${"b".repeat(16)}`,
    );
    const route = async (f: typeof sender) => ({
      repositoryRoot: f.root,
      repositoryInstanceId: (await resolveRepositoryCoordinationHome(f.root)).repositoryInstanceId,
      projectId: f.owner.projectId,
      teamId: f.mandate.teamIds[0]!,
      binding: f.binding,
    });
    const senderRoute = await route(sender);
    const recipientRoute = await route(recipient);
    const observe = async (configuration: typeof senderRoute) => {
      const peer = await SupervisionPeerSource.open(configuration, sender.ports.now);
      try {
        return await peer.read();
      } finally {
        await peer.close();
      }
    };
    const source = await observe(senderRoute);
    const target = await observe(recipientRoute);
    const request = {
      objective: "Inspect the shared source policy",
      deliverables: ["One source-policy review"],
      acceptanceCriteria: ["Identify the exact policy and evidence"],
      evidenceArtifactHashes: [],
    };
    const rationale = "Request the bounded review while retaining the original repository goal.";
    const offer: ScopedWorkHandoffV1 = {
      schemaVersion: 1,
      kind: "work.scoped_handoff",
      purpose,
      source: source.party,
      recipient: target.party,
      sourceSnapshotHash: source.workstreamSnapshotHash,
      recipientSnapshotHash: target.workstreamSnapshotHash,
      requestArtifactHash: operatingContractHash(request),
      acceptanceHash: operatingContractHash(request.acceptanceCriteria),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      rationaleArtifactHash: operatingContractHash(rationale),
    };
    const senderStorage = await openProjectStorage(sender.root);
    const targetStorage = await openProjectStorage(recipient.root);
    try {
      for (const storage of [senderStorage, targetStorage])
        for (const artifact of [offer, request, rationale])
          await storage.artifacts.put(canonicalJson(artifact));
      const run = async (
        f: typeof sender,
        peer: typeof senderRoute,
        effect: ScopedWorkHandoffV1 | ScopedWorkHandoffAcceptanceV1,
      ) => {
        const storage = f === sender ? senderStorage : targetStorage;
        await storage.artifacts.put(canonicalJson(effect));
        let admitted: OperatingActionPlanV1 | undefined;
        const runtime = await openNodeOutcomeSupervisionRuntime({
          repositoryRoot: f.root,
          binding: f.binding,
          handoffPeers: [peer],
          ports: {
            now: f.ports.now,
            recordAttention: f.ports.recordAttention,
            propose: async (report) => {
              const tasks = await new SupervisionTaskSource(storage, f.binding, f.ports.now).read();
              admitted = {
                schemaVersion: 1,
                ...f.binding,
                projectId: f.owner.projectId,
                teamId: f.mandate.teamIds[0]!,
                sourceRevisionDigest: report.sourceRevisionDigest,
                graphHash: tasks.graph.graphHash,
                causationEventIds: report.causationEventIds,
                rationaleArtifactHash: effect.rationaleArtifactHash,
                ...scopedHandoffFields(effect, f.owner.roleId, "codex", offer.expiresAt, offer),
              };
              const { facts } = await canonicalOwnerReasoningFacts(
                storage,
                f.binding,
                tasks,
                f.ports.now,
              );
              const details =
                effect.kind === "work.scoped_handoff_acceptance"
                  ? { handoffHash: effect.handoffHash }
                  : { recipientProjectId: recipient.owner.projectId, request };
              const nativeInput = {
                storage,
                facts,
                base: admitted,
                decision: {
                  schemaVersion: 1 as const,
                  operation:
                    effect.kind === "work.scoped_handoff_acceptance"
                      ? ("accept_team_support" as const)
                      : purpose === "central_escalation"
                        ? ("escalate" as const)
                        : ("request_team_support" as const),
                  rationale,
                  details: JSON.stringify(details),
                },
                reasoningPlanHash: operatingContractHash("controlled native proposal"),
                resultArtifactHash: operatingContractHash("controlled native response"),
                readiness: { providerExecutables: {}, verificationTools: {} },
                now:
                  effect.kind === "work.scoped_handoff_acceptance"
                    ? () => effect.acceptedAt
                    : f.ports.now,
              };
              await expect(
                nativeScopedHandoff(
                  nativeInput,
                  effect.kind === "work.scoped_handoff_acceptance"
                    ? { handoffHash: operatingContractHash("unobserved offer") }
                    : { recipientProjectId: `prj_${"c".repeat(16)}`, request },
                  effect.rationaleArtifactHash,
                ),
              ).rejects.toThrow(/observed|available/iu);
              if (effect.kind === "work.scoped_handoff")
                await expect(
                  nativeScopedHandoff(
                    nativeInput,
                    {
                      recipientProjectId: recipient.owner.projectId,
                      request: {
                        ...request,
                        evidenceArtifactHashes: [operatingContractHash("missing evidence")],
                      },
                    },
                    effect.rationaleArtifactHash,
                  ),
                ).rejects.toThrow(/evidence is unavailable/iu);
              const native = await nativeScopedHandoff(
                nativeInput,
                details,
                effect.rationaleArtifactHash,
              );
              expect(native.effect).toEqual(effect);
              expect(native.fields).toEqual(
                scopedHandoffFields(effect, f.owner.roleId, "codex", offer.expiresAt, offer),
              );
              return admitted;
            },
            execute: async () => {
              throw new Error("Custom adapter must not execute handoffs.");
            },
            inspectEffect: async () => {
              throw new Error("Custom adapter must not inspect handoffs.");
            },
          },
        });
        try {
          const result = await runtime.runCycle();
          expect(f.attention, JSON.stringify(result)).toEqual([]);
          expect(admitted).toBeDefined();
          if (effect.kind === "work.scoped_handoff") {
            const head = storage.events.latest()!.eventHash;
            expect((await runtime.runCycle()).disposition).toBe("idle");
            expect((await runtime.runCycle()).disposition).toBe("idle");
            expect(storage.events.latest()!.eventHash).toBe(head);
          }
        } finally {
          await runtime.close();
        }
        const adapter = new SupervisionHandoffEffects(f.root, f.binding, [peer], f.ports.now);
        const inspected = await adapter.inspect(admitted!);
        expect(inspected.status).toBe("confirmed");
        // A lost outer receipt can replay after restart without appending or requiring peer availability.
        const before = storage.events.latest()!.seq;
        const replay = new SupervisionHandoffEffects(f.root, f.binding, [], f.ports.now);
        await expect(
          replay.execute(admitted!, {
            commit: () => {
              throw new Error("duplicate write");
            },
          }),
        ).resolves.toEqual({ eventIds: inspected.eventIds });
        expect(storage.events.latest()!.seq).toBe(before);
        return storage.events.get(inspected.eventIds![0]!)!;
      };
      const offered = await run(sender, recipientRoute, offer);
      expect(
        targetStorage.events
          .list()
          .some((event) => event.type === "work.supervision.handoff.accepted"),
      ).toBe(false);
      const acceptance: ScopedWorkHandoffAcceptanceV1 = {
        schemaVersion: 1,
        kind: "work.scoped_handoff_acceptance",
        handoffHash: operatingContractHash(offer),
        recipient: offer.recipient,
        sourceOfferEventId: offered.eventId,
        sourceOfferEventHash: offered.eventHash,
        recipientSnapshotHash: offer.recipientSnapshotHash,
        acceptedAt: sender.ports.now(),
        rationaleArtifactHash: offer.rationaleArtifactHash,
      };
      const accepted = await run(recipient, senderRoute, acceptance);
      expect(accepted.payload.sourceOfferEventHash).toBe(offered.eventHash);
      expect(accepted.projectId).toBe(recipient.owner.projectId);
      expect(offered.projectId).toBe(sender.owner.projectId);
      expect(await listAssignments(sender.root)).toEqual([]);
      expect(await listAssignments(recipient.root)).toEqual([]);
      expect((await readCurrentWorkstreamState(sender.root))!.contentHash).toBe(
        offer.sourceSnapshotHash,
      );
      expect((await readCurrentWorkstreamState(recipient.root))!.contentHash).toBe(
        offer.recipientSnapshotHash,
      );
      const ownerStore = await NodeSupervisionStore.open({
        repositoryRoot: sender.root,
        binding: sender.binding,
        now: sender.ports.now,
      });
      const catalog = new SupervisionPeerCatalog(
        senderStorage,
        sender.binding,
        [recipientRoute],
        sender.ports.now,
      );
      try {
        await ownerStore.withOwner((owner) => catalog.refresh(owner));
        const snapshot = await new SupervisionTaskSource(
          senderStorage,
          sender.binding,
          sender.ports.now,
        ).readSnapshot();
        expect(snapshot.handoffs?.pendingOutgoing).toEqual([]);
        const head = senderStorage.events.latest()!.eventHash;
        await ownerStore.withOwner((owner) => catalog.refresh(owner));
        expect(senderStorage.events.latest()!.eventHash).toBe(head);
      } finally {
        await ownerStore.close();
        await catalog.close();
      }
    } finally {
      await senderStorage.close();
      await targetStorage.close();
    }
  },
  60_000,
);
