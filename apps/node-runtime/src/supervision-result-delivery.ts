import type { OperatingActionPlanV1, SupervisedResultDelivery } from "@lervo/application-contract";
import type { ConversationAdapter } from "@lervo/conversation-contract";
import { canonicalJson } from "@lervo/event-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { validateSchema, type ConversationOutboundMessage } from "@lervo/schemas";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { NodeSupervisionSession } from "./supervision-session.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import { observeSupervisionTasks } from "./supervision-task-observation.js";
import { readCanonicalResultDelivery } from "./supervision-result-delivery-basis.js";
import { readResultDeliveryReceipt } from "./supervision-result-delivery-receipt.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";

export interface NodeSupervisionResultDeliveryConfiguration {
  adapter: ConversationAdapter;
  origin: Pick<ConversationOutboundMessage, "sourceEventId" | "policyId" | "target" | "actor">;
}

/** Owns publication attempts only. It never calls a model or restarts accepted work. */
export class SupervisionResultDelivery {
  private readonly tasks: SupervisionTaskSource;
  private readonly origin: NodeSupervisionResultDeliveryConfiguration["origin"];
  constructor(
    private readonly storage: ProjectStorage,
    private readonly binding: NodeSupervisionBinding,
    private readonly configuration: NodeSupervisionResultDeliveryConfiguration,
    private readonly now: () => string,
  ) {
    this.origin = structuredClone(configuration.origin);
    this.tasks = new SupervisionTaskSource(storage, binding, now);
  }
  private async publication(plan: OperatingActionPlanV1, excludeDecision = false) {
    const effect = (await readSupervisionJsonArtifact(
      this.storage.artifacts,
      plan.effectHash,
    )) as SupervisedResultDelivery;
    const source = await this.tasks.read(excludeDecision ? operatingDecisionId(plan) : undefined);
    const observed = await observeSupervisionTasks(
      source,
      this.storage.artifacts,
      this.binding,
      this.storage.events,
    );
    const { outbound } = await readCanonicalResultDelivery({
      ...this.storage,
      source,
      observed,
      effect,
    });
    if (
      Object.entries(this.origin).some(
        ([key, value]) =>
          operatingContractHash(value) !==
          operatingContractHash(outbound[key as keyof ConversationOutboundMessage]),
      ) ||
      outbound.target.integrationId !== this.configuration.adapter.descriptor.integrationId ||
      outbound.target.projectId !== plan.projectId ||
      outbound.actor.roleId !== plan.roleId
    )
      throw new Error("The result delivery target differs from its configured origin.");
    return { effect, source, outbound };
  }
  async assertReady(plan: OperatingActionPlanV1) {
    await this.publication(plan, true);
  }
  async inspect(plan: OperatingActionPlanV1) {
    const effect = (await readSupervisionJsonArtifact(
      this.storage.artifacts,
      plan.effectHash,
    )) as SupervisedResultDelivery;
    const receipt = await readResultDeliveryReceipt(this.storage, plan, effect);
    return receipt.status === "not_started"
      ? { status: "not_started" as const }
      : { status: "confirmed" as const, eventIds: [receipt.eventId] };
  }
  async enqueue(
    plan: OperatingActionPlanV1,
    owner: NodeSupervisionSession,
    authorityDigest: string,
  ) {
    const { effect, source } = await this.publication(plan, true);
    const receipt = await readResultDeliveryReceipt(this.storage, plan, effect);
    if (receipt.status !== "not_started") return { eventIds: [receipt.eventId] };
    const authority = await owner.readAuthority();
    if (
      authority.source.sourceRevisionDigest !== authorityDigest ||
      plan.sourceRevisionDigest !==
        operatingContractHash({ authorityDigest, taskDigest: source.sourceRevisionDigest })
    )
      throw new Error("The publication source changed before queueing.");
    owner.commit(() => {
      if (
        this.storage.events.latest()?.eventHash !== source.events.at(-1)?.eventHash ||
        Date.parse(this.now()) >= Date.parse(plan.deadline)
      )
        throw new Error("The publication authority changed at commit.");
      this.storage.events.append({
        eventId: receipt.eventId,
        projectId: plan.projectId,
        runId: receipt.runId,
        sessionId: receipt.decision.sessionId,
        type: "work.supervision.delivery.queued",
        schemaVersion: 3,
        actor: { kind: "system" },
        occurredAt: this.now(),
        policyVersion: plan.mandateHash,
        payload: receipt.payload,
      });
    });
    return { eventIds: [receipt.eventId] };
  }
  async runPending(owner: NodeSupervisionSession) {
    const source = await this.tasks.read();
    const queued = source.supervisionEvents.findLast(
      (event) => event.type === "work.supervision.delivery.queued",
    );
    if (queued === undefined) return;
    if (
      source.workstream.status !== "completed" ||
      this.storage.events.get(String(queued.payload.completionEventId))?.payload
        .snapshotContentHash !== source.workstreamHash
    )
      return;
    const plan = (await readSupervisionJsonArtifact(
      this.storage.artifacts,
      String(queued.payload.planHash),
    )) as OperatingActionPlanV1;
    const effect = (await readSupervisionJsonArtifact(
      this.storage.artifacts,
      plan.effectHash,
    )) as SupervisedResultDelivery;
    const state = await readResultDeliveryReceipt(this.storage, plan, effect);
    if (
      state.status === "not_started" ||
      state.status === "delivered" ||
      state.attempt >= 4 ||
      state.nextCheckAt === null ||
      Date.parse(state.nextCheckAt) > Date.parse(this.now())
    )
      return;
    const authority = await owner.readAuthority();
    const { outbound, source: admittedSource } = await this.publication(plan);
    const current = await owner.readAuthority();
    if (
      authority.source.sourceRevisionDigest !== current.source.sourceRevisionDigest ||
      Date.parse(this.now()) >= Date.parse(plan.deadline)
    )
      return;
    owner.commit(() => {
      if (this.storage.events.latest()?.eventHash !== admittedSource.events.at(-1)?.eventHash)
        throw new Error("The accepted result changed immediately before delivery.");
    });
    let receiptArtifactHash: string | null = null;
    let status: "delivered" | "failed" = "failed";
    try {
      const receipt = await this.configuration.adapter.deliver(outbound);
      if (
        !validateSchema("conversationDeliveryReceipt", receipt).valid ||
        receipt.outboundId !== outbound.outboundId ||
        receipt.integrationId !== outbound.target.integrationId
      )
        throw new Error("The transport returned a different delivery receipt.");
      receiptArtifactHash = (await this.storage.artifacts.put(canonicalJson(receipt))).contentHash;
      status = "delivered";
    } catch {
      /* The frozen outbound remains retryable through the adapter's idempotency contract. */
    }
    const attempt = state.attempt + 1;
    const nextCheckAt =
      status === "failed" &&
      attempt < 4 &&
      Date.parse(this.now()) + 5000 < Date.parse(plan.deadline)
        ? new Date(Date.parse(this.now()) + 5000).toISOString()
        : null;
    owner.commit(() =>
      this.storage.events.append({
        eventId: `evt_${operatingContractHash({ runId: state.runId, type: "work.supervision.delivery.observed", identity: `${state.identity}:${attempt}` }).slice(7, 39)}`,
        projectId: plan.projectId,
        runId: state.runId,
        sessionId: state.decision.sessionId,
        type: "work.supervision.delivery.observed",
        schemaVersion: 3,
        actor: { kind: "system" },
        occurredAt: this.now(),
        policyVersion: plan.mandateHash,
        payload: {
          ...state.common,
          decisionId: state.identity,
          planHash: operatingContractHash(plan),
          outboundId: outbound.outboundId,
          attemptNumber: attempt,
          status,
          receiptArtifactHash,
          reasonCode: status === "delivered" ? "result_delivered" : "result_transport_failed",
          nextCheckAt,
        },
      }),
    );
  }
}
