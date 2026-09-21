import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import {
  listAgents,
  listAssignments,
  reconcileAssignmentCompletion,
  reconcileSettledAssignmentCompletion,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { readBoundWorkstreamState } from "./supervision-workstream-state.js";
import {
  managedExecutionIdentity,
  operatingContractHash,
  operatingDecisionId,
} from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { readCanonicalAssignmentCompletion } from "./supervision-assignment-completion-source.js";
import {
  assignmentCompletionReceiptBasis,
  inspectAssignmentCompletionReceipt,
} from "./supervision-assignment-completion-receipt.js";

/** Records independently verified completion evidence, then reconciles one exact assignment. */
export class SupervisionAssignmentCompletionEffects {
  private readonly binding: NodeSupervisionBinding;
  constructor(
    private readonly root: string,
    binding: NodeSupervisionBinding,
    private readonly now: () => string,
  ) {
    this.binding = structuredClone(binding);
  }
  async inspect(
    plan: OperatingActionPlanV1,
    session?: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    const storage = await openProjectStorage(this.root);
    try {
      const observed = await inspectAssignmentCompletionReceipt(storage, plan);
      if (observed.status !== "uncertain" || session === undefined) return observed;
      const basis = await assignmentCompletionReceiptBasis(storage, plan);
      if (
        storage.events.get(basis.preparedEventId) === null ||
        storage.events.get(basis.reconciledEventId) !== null
      )
        return observed;
      const recovered = await this.execute(plan, session);
      return { status: "confirmed" as const, eventIds: recovered.eventIds };
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
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read(
        operatingDecisionId(plan),
      );
      const basis = await readCanonicalAssignmentCompletion({
        storage,
        source,
        binding: this.binding,
        plan,
        now: this.now,
      });
      const receipt = await assignmentCompletionReceiptBasis(storage, plan);
      const authority = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
      const prepared = storage.events.get(receipt.preparedEventId);
      if (
        prepared !== null &&
        (prepared.type !== "assignment.completion.prepared" ||
          prepared.schemaVersion !== 3 ||
          prepared.actor.kind !== "system" ||
          prepared.seq <= receipt.decision.seq ||
          prepared.runId !== receipt.coordinate.runId ||
          prepared.sessionId !== receipt.coordinate.sessionId ||
          prepared.occurredAt !== basis.effect.preparedAt ||
          operatingContractHash(prepared.payload) !==
            operatingContractHash(receipt.preparedPayload))
      )
        throw new Error("The durable completion preparation is inconsistent.");
      if (
        authority.installation.revoked ||
        !authority.source.eligible ||
        (prepared === null &&
          operatingContractHash({
            authorityDigest: authority.source.sourceRevisionDigest,
            taskDigest: source.sourceRevisionDigest,
          }) !== plan.sourceRevisionDigest) ||
        Date.parse(this.now()) >=
          Math.min(
            Date.parse(plan.deadline),
            Date.parse(authority.installation.mandate.expiresAt),
            prepared === null && basis.effect.schemaVersion !== 3
              ? Date.parse(basis.assignment.lease!.expiresAt)
              : Infinity,
          )
      )
        throw new Error("The completion preparation authority or lease expired.");
      if (prepared === null)
        session.commit(() => {
          if (storage.events.latest()?.eventHash !== source.events.at(-1)?.eventHash)
            throw new Error("The completion preparation source changed.");
          storage.events.append({
            eventId: receipt.preparedEventId,
            projectId: plan.projectId,
            runId: receipt.coordinate.runId,
            sessionId: receipt.coordinate.sessionId,
            type: "assignment.completion.prepared",
            schemaVersion: 3,
            occurredAt: basis.effect.preparedAt,
            actor: { kind: "system" },
            policyVersion: plan.mandateHash,
            payload: receipt.preparedPayload,
          });
        });
      const head = storage.events.latest()?.eventHash;
      const assignments = await listAssignments(this.root);
      const expected = {
        ...basis.assignment,
        status: "completed",
        lease: null,
        failureCode: null,
        resultArtifacts: [
          {
            artifactId: receipt.coordinate.resultArtifactId,
            contentHash: receipt.coordinate.resultContentHash,
          },
        ],
        revision: basis.assignment.revision + 1,
        updatedAt: this.now(),
      };
      const reconcile =
        basis.effect.schemaVersion === 3
          ? (input: Parameters<typeof reconcileAssignmentCompletion>[0]) =>
              reconcileSettledAssignmentCompletion({
                ...input,
                executionCompletedAt: receipt.terminal.occurredAt,
              })
          : reconcileAssignmentCompletion;
      await reconcile({
        repositoryRoot: this.root,
        ...receipt.coordinate,
        completionEvidenceId: receipt.evidenceId,
        reconciliationCommandId: receipt.commandId,
        sourceRunId: receipt.terminal.runId,
        resultArtifact: expected.resultArtifacts[0]!,
        now: new Date(expected.updatedAt),
        recordEvent: async (event) => {
          const fresh = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
          const current = await listAssignments(this.root);
          const others = (items: typeof assignments) =>
            items.filter((item) => item.assignmentId !== basis.assignment.assignmentId);
          const agents = await listAgents(this.root);
          const workstream = await readBoundWorkstreamState(storage, this.binding.workstreamId);
          session.commit(() => {
            if (
              fresh.source.sourceRevisionDigest !== authority.source.sourceRevisionDigest ||
              fresh.installation.revoked ||
              Date.parse(this.now()) >=
                Math.min(
                  Date.parse(plan.deadline),
                  Date.parse(fresh.installation.mandate.expiresAt),
                ) ||
              operatingContractHash(others(current)) !==
                operatingContractHash(others(assignments)) ||
              operatingContractHash(
                current.find((item) => item.assignmentId === expected.assignmentId),
              ) !== operatingContractHash(expected) ||
              operatingContractHash(agents) !== operatingContractHash(source.agents) ||
              workstream?.contentHash !== source.workstreamHash ||
              storage.events.latest()?.eventHash !== head
            )
              throw new Error("The completion authority changed during the assignment transition.");
            storage.events.append({
              eventId: receipt.reconciledEventId,
              projectId: plan.projectId,
              ...managedExecutionIdentity(plan.projectId, operatingContractHash(plan)),
              type: event.type,
              schemaVersion: 3,
              occurredAt: event.occurredAt,
              actor: { kind: "system" },
              policyVersion: plan.mandateHash,
              payload: event.payload,
            });
          });
        },
      });
      const result = await inspectAssignmentCompletionReceipt(storage, plan);
      if (result.status !== "confirmed")
        throw new Error("The assignment completion requires reconciliation.");
      return { eventIds: result.eventIds };
    } finally {
      await storage.close();
    }
  }
}
