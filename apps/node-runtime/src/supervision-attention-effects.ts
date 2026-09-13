import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { readCanonicalSupervisionAttention } from "./supervision-attention-source.js";
import {
  inspectSupervisionAttentionReceipt,
  supervisionAttentionReceiptBasis,
} from "./supervision-attention-receipt.js";

/** Persists one local decision need; it does not claim a central recipient or send a message. */
export class SupervisionAttentionEffects {
  constructor(
    private readonly root: string,
    private readonly binding: NodeSupervisionBinding,
    private readonly now: () => string,
  ) {
    this.binding = structuredClone(binding);
  }
  async inspect(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.root);
    try {
      return await inspectSupervisionAttentionReceipt(storage, plan);
    } finally {
      await storage.close();
    }
  }
  async execute(
    plan: OperatingActionPlanV1,
    session: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    const storage = await openProjectStorage(this.root);
    try {
      const existing = await inspectSupervisionAttentionReceipt(storage, plan);
      if (existing.status === "confirmed") return { eventIds: existing.eventIds };
      const basis = await supervisionAttentionReceiptBasis(storage, plan);
      const tasks = new SupervisionTaskSource(storage, this.binding, this.now);
      const source = await tasks.read(operatingDecisionId(plan));
      await readCanonicalSupervisionAttention({
        storage,
        source,
        binding: this.binding,
        plan,
        now: this.now,
      });
      const authority = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
      if (
        authority.installation.revoked ||
        !authority.source.eligible ||
        authority.source.teamId !== plan.teamId ||
        operatingContractHash({
          authorityDigest: authority.source.sourceRevisionDigest,
          taskDigest: source.sourceRevisionDigest,
        }) !== plan.sourceRevisionDigest ||
        (await tasks.read(operatingDecisionId(plan))).sourceRevisionDigest !==
          source.sourceRevisionDigest
      )
        throw new Error("Owner attention lost its current authority or source.");
      session.commit(() =>
        storage.events.transact((transaction) => {
          if (
            Date.parse(this.now()) >=
              Math.min(
                Date.parse(plan.deadline),
                Date.parse(authority.installation.mandate.expiresAt),
              ) ||
            storage.events.latest()?.eventHash !== source.events.at(-1)?.eventHash
          )
            throw new Error("The owner attention deadline or event source changed.");
          const result = transaction.append({
            eventId: basis.eventId,
            projectId: plan.projectId,
            runId: basis.runId,
            sessionId: basis.decision.sessionId,
            schemaVersion: 3,
            type: basis.type,
            occurredAt: this.now(),
            policyVersion: plan.mandateHash,
            actor: { kind: "system" },
            payload: basis.payload,
          });
          if (result.redactions.length > 0)
            throw new Error("The owner attention receipt was redacted.");
        }),
      );
      return { eventIds: [basis.eventId] };
    } finally {
      await storage.close();
    }
  }
}
