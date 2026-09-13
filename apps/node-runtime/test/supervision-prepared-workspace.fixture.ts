import { canonicalJson } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  projectOutcomeSupervision,
  reviewOperatingAction,
  supervisedWorkspacePreparationFields,
} from "@lervo/work-controller";
import { NodeSupervisionStore } from "../src/supervision-store.js";
import { recordSupervisionWorkspaceReceipt } from "../src/supervision-workspace-receipt.js";
import type { dispatchFixture } from "./supervision-dispatch.fixture.js";

/** Records admission and the actual fixture host receipt through the fenced native journal. */
export async function recordPreparedWorkspaceFixture(
  f: Awaited<ReturnType<typeof dispatchFixture>>,
) {
  const storage = await openProjectStorage(f.root);
  const owner = await NodeSupervisionStore.open({
    repositoryRoot: f.root,
    binding: f.binding,
    now: f.ports.now,
  });
  try {
    const provision = await storage.artifacts.put(canonicalJson(f.provision));
    const rationale = await storage.artifacts.put(
      canonicalJson("Prepare the assigned Git checkout."),
    );
    const effect = {
      schemaVersion: 1 as const,
      kind: "work.workspace_preparation" as const,
      responsibility: f.task,
      provider: "codex" as const,
      provisionPlanHash: provision.contentHash,
      rationaleArtifactHash: rationale.contentHash,
    };
    await storage.artifacts.put(canonicalJson(effect));
    const report = projectOutcomeSupervision({
      snapshot: f.observation,
      now: f.ports.now(),
      maximumRecoveryDecisions: 3,
    });
    const plan = {
      ...(await f.ports.propose(report))!,
      ...supervisedWorkspacePreparationFields(effect),
    };
    await owner.withOwner(async (session) => {
      const authority = await session.readAuthority();
      const review = reviewOperatingAction({
        mandate: authority.installation.mandate,
        plan,
        snapshot: {
          ...(await f.ports.readAdmission(plan)),
          installedMandateHash: f.binding.mandateHash,
          installationReviewHash: authority.installation.installationReviewHash,
          revocationCoordinate: authority.installation.mandate.revocationCoordinate,
          effectMappings: [
            { actionKind: "execute_as_owner", contract: "work.workspace_preparation.v1" },
          ],
        },
      });
      const recorded = await session.recordDecision(
        plan,
        review,
        authority.source.sourceRevisionDigest,
      );
      const receipt = await recordSupervisionWorkspaceReceipt({
        storage,
        plan,
        now: f.ports.now,
        commit: session.commit,
      });
      session.recordEffect({
        ...recorded,
        status: "effect_confirmed",
        effectEventIds: receipt.eventIds,
      });
    });
  } finally {
    await owner.close();
    await storage.close();
  }
}
