import { resolve } from "node:path";

import { projectAgentOrganization } from "@lervo/agent-organization";
import type { ConversationDeliberationQueueInspection } from "@lervo/conversation-deliberation-sqlite";
import { inspectConversationDeliberationQueues } from "@lervo/conversation-deliberation-sqlite";
import { rootWorkId } from "@lervo/execution-contract";
import {
  projectWorkExecutionReport,
  WorkExecutionReportError,
} from "@lervo/execution-observability";
import type { ConversationOutboundDeliveryRecord } from "@lervo/interaction-sqlite";
import { inspectConversationOutboundDeliveries } from "@lervo/interaction-sqlite";
import { captureRepositorySnapshot } from "@lervo/orchestrator";
import {
  projectDeliberationApplicationView,
  type ProductDeliberationParticipantBindingV1,
} from "@lervo/product-surface-projection";
import { openReadOnlyProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope, ProductDeliberationViewV1 } from "@lervo/schemas";
import { loadVerificationSuite } from "@lervo/verification";

import {
  defaultProductDeliberationPolicyDependencies,
  ProductDeliberationSourceError,
  resolveProductDeliberationPolicy,
  type ProductDeliberationPolicyDependencies,
} from "./product-deliberation-policy.js";

const maximumProjectionEvents = 100_000;
const eventPageSize = 1_000;

interface ProductDeliberationInspectionDependencies {
  openStorage(root: string): Promise<ProjectStorage>;
  captureSnapshot(root: string): Promise<{ revision: string }>;
  inspectQueues(input: {
    startPath: string;
    resumePath: string;
    projectId: string;
    deliberationId: string;
  }): Promise<ConversationDeliberationQueueInspection>;
  inspectDeliveries(input: {
    path: string;
    sourceEventId: string;
  }): Promise<ConversationOutboundDeliveryRecord[]>;
  loadVerificationSuite(
    repositoryRoot: string,
    suiteId: string,
  ): ReturnType<typeof loadVerificationSuite>;
  policy: ProductDeliberationPolicyDependencies;
}

export interface ProductDeliberationInspectionInput {
  repositoryRoot: string;
  integrationId: string;
  deliberationId: string;
}

export type InspectProductDeliberation = (
  input: ProductDeliberationInspectionInput,
) => Promise<ProductDeliberationViewV1>;

const defaultDependencies: ProductDeliberationInspectionDependencies = {
  openStorage: openReadOnlyProjectStorage,
  captureSnapshot: captureRepositorySnapshot,
  inspectQueues: inspectConversationDeliberationQueues,
  inspectDeliveries: inspectConversationOutboundDeliveries,
  loadVerificationSuite,
  policy: defaultProductDeliberationPolicyDependencies,
};

function stable(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readVerifiedEvents(storage: ProjectStorage): {
  events: EventEnvelope[];
  headHash: string;
} {
  const integrity = storage.events.verifyIntegrity();
  if (
    !integrity.valid ||
    integrity.headHash === null ||
    integrity.eventCount < 1 ||
    integrity.eventCount > maximumProjectionEvents
  ) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The deliberation projection requires one bounded valid canonical event chain.",
    );
  }
  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  while (events.length < integrity.eventCount) {
    const page = storage.events
      .list({
        afterSeq,
        limit: Math.min(eventPageSize, integrity.eventCount - events.length),
      })
      .filter((event) => event.seq <= integrity.eventCount);
    if (page.length === 0) break;
    events.push(...page);
    afterSeq = page.at(-1)!.seq;
  }
  if (events.length !== integrity.eventCount || events.at(-1)?.eventHash !== integrity.headHash) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_changed",
      "The canonical event head changed during deliberation inspection.",
    );
  }
  return { events, headHash: integrity.headHash };
}

function queueStatus(queues: ConversationDeliberationQueueInspection) {
  if (queues.start === null) {
    throw new ProductDeliberationSourceError(
      "deliberation_not_found",
      "The requested installed conversation deliberation does not exist.",
    );
  }
  if (
    queues.resume !== null &&
    (queues.start.state !== "settled" || queues.start.summary?.status !== "interrupted")
  ) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The deliberation resume queue has no interrupted start source.",
    );
  }
  const job = queues.resume ?? queues.start;
  const notification =
    queues.resume === null ? queues.startNotification : queues.resumeNotification;
  if (
    (job.state === "settled") !== (notification !== null) ||
    !stable(job.summary, notification?.summary ?? null)
  ) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The deliberation queue settlement and notification obligation differ.",
    );
  }
  const status =
    job.state === "settled"
      ? job.summary!.status
      : job.state === "uncertain"
        ? ("unknown" as const)
        : ("running" as const);
  return { job, notification, status };
}

function participantBindings(input: {
  projectId: string;
  deliberationId: string;
  policyHash: string;
  policy: Awaited<ReturnType<typeof resolveProductDeliberationPolicy>>["policy"];
  events: readonly EventEnvelope[];
}): ProductDeliberationParticipantBindingV1[] {
  const organization = projectAgentOrganization({
    projectId: input.projectId,
    events: input.events,
  });
  const candidates = organization.deliberationParticipants.filter(
    (binding) => binding.deliberationId === input.deliberationId,
  );
  if (candidates.some((binding) => binding.deliberationPolicyHash !== input.policyHash)) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "A deliberation participant binding names another policy revision.",
    );
  }
  return candidates.map((binding) => {
    const participant = input.policy.participants.find((item) => item.roleId === binding.roleId);
    if (participant === undefined) {
      throw new ProductDeliberationSourceError(
        "deliberation_source_invalid",
        "A deliberation participant binding names a role outside the policy.",
      );
    }
    const selectedProvider =
      participant.providerSelection.mode === "fixed"
        ? participant.providerSelection.provider
        : "any";
    if (
      selectedProvider !== "codex" &&
      selectedProvider !== "claude" &&
      selectedProvider !== "any"
    ) {
      throw new ProductDeliberationSourceError(
        "deliberation_source_invalid",
        "The deliberation participant provider is unsupported by the product projection.",
      );
    }
    const provider: ProductDeliberationParticipantBindingV1["provider"] = selectedProvider;
    return {
      roleId: binding.roleId,
      provider,
      providerPolicyHash: binding.providerPolicyHash,
      participantId: binding.participantId,
      agentId: binding.agentId,
      roleVersion: binding.roleVersion,
    };
  });
}

function deliveryCoordinates(input: {
  integrationId: string;
  projectId: string;
  origin: NonNullable<ConversationDeliberationQueueInspection["start"]>["origin"];
  records: readonly ConversationOutboundDeliveryRecord[];
}) {
  if (input.records.length === 0) {
    return { publicationCoordinate: null, originDeliveryCoordinate: null };
  }
  if (input.records.length !== 1 || input.origin === null) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The terminal notification does not resolve to exactly one origin-bound outbound.",
    );
  }
  const record = input.records[0]!;
  if (
    record.outbound.target.integrationId !== input.integrationId ||
    record.outbound.target.projectId !== input.projectId ||
    record.outbound.target.conversationId !== input.origin.conversationId ||
    record.outbound.target.threadId !== input.origin.threadId
  ) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The terminal outbound target differs from the immutable deliberation origin.",
    );
  }
  return {
    publicationCoordinate: `writing-permit:${record.outbound.publicationPermit.permitId}`,
    originDeliveryCoordinate:
      record.receipt === null ? null : `conversation-delivery:${record.receipt.deliveryKeyHash}`,
  };
}

export async function inspectProductDeliberation(
  input: ProductDeliberationInspectionInput,
  dependencies: ProductDeliberationInspectionDependencies = defaultDependencies,
): Promise<ProductDeliberationViewV1> {
  if (
    !/^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(input.integrationId) ||
    !/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(input.deliberationId)
  ) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The product deliberation query coordinates are invalid.",
    );
  }
  const storage = await dependencies.openStorage(input.repositoryRoot);
  try {
    const dataDirectory = resolve(storage.paths.data, "conversation", input.integrationId);
    const queueInput = {
      startPath: resolve(dataDirectory, "deliberations.sqlite"),
      resumePath: resolve(dataDirectory, "deliberation-resumes.sqlite"),
      projectId: storage.manifest.projectId,
      deliberationId: input.deliberationId,
    };
    const queuesBefore = await dependencies.inspectQueues(queueInput);
    const current = queueStatus(queuesBefore);
    const repositoryBefore = await dependencies.captureSnapshot(input.repositoryRoot);
    const source = readVerifiedEvents(storage);
    const resolvedPolicy = await resolveProductDeliberationPolicy({
      repositoryRoot: input.repositoryRoot,
      projectId: storage.manifest.projectId,
      deliberationId: input.deliberationId,
      policyId: queuesBefore.start!.policyId,
      events: source.events,
      dependencies: dependencies.policy,
    });
    const policyHash = resolvedPolicy.startedEvent.payload.policyHash;
    const bindings = participantBindings({
      projectId: storage.manifest.projectId,
      deliberationId: input.deliberationId,
      policyHash,
      policy: resolvedPolicy.policy,
      events: source.events,
    });
    const workId = rootWorkId(storage.manifest.projectId, resolvedPolicy.startedEvent.runId);
    let resourceReportCoordinate: string | null = null;
    try {
      projectWorkExecutionReport({
        projectId: storage.manifest.projectId,
        workId,
        events: source.events,
      });
      resourceReportCoordinate = `work:${workId}`;
    } catch (error) {
      if (!(error instanceof WorkExecutionReportError) || error.code !== "work_not_found")
        throw error;
    }
    const interactionPath = resolve(dataDirectory, "interactions.sqlite");
    const deliveryBefore =
      current.notification?.state === "accepted" &&
      current.notification.conversationEventId !== null
        ? await dependencies.inspectDeliveries({
            path: interactionPath,
            sourceEventId: current.notification.conversationEventId,
          })
        : [];
    const delivery = deliveryCoordinates({
      integrationId: input.integrationId,
      projectId: storage.manifest.projectId,
      origin: queuesBefore.start!.origin,
      records: deliveryBefore,
    });
    const repositoryAfter = await dependencies.captureSnapshot(input.repositoryRoot);
    const queuesAfter = await dependencies.inspectQueues(queueInput);
    const deliveryAfter =
      current.notification?.state === "accepted" &&
      current.notification.conversationEventId !== null
        ? await dependencies.inspectDeliveries({
            path: interactionPath,
            sourceEventId: current.notification.conversationEventId,
          })
        : [];
    if (
      repositoryBefore.revision !== repositoryAfter.revision ||
      !stable(queuesBefore, queuesAfter) ||
      !stable(deliveryBefore, deliveryAfter)
    ) {
      throw new ProductDeliberationSourceError(
        "deliberation_source_changed",
        "Deliberation projection sources changed during inspection.",
      );
    }
    const view = await projectDeliberationApplicationView({
      deliberationId: input.deliberationId,
      projectId: storage.manifest.projectId,
      status: current.status,
      policy: resolvedPolicy.policy,
      origin:
        queuesBefore.start!.origin === null
          ? null
          : {
              sourceEventId: queuesBefore.start!.sourceEventId,
              ...queuesBefore.start!.origin,
            },
      events: source.events,
      readArtifact: (uri) => storage.artifacts.get(uri),
      loadVerificationSuite: (suiteId) =>
        dependencies.loadVerificationSuite(input.repositoryRoot, suiteId),
      participantBindings: bindings,
      sourceEventHeadHash: source.headHash,
      repositoryRevision: repositoryBefore.revision,
      resourceReportCoordinate,
      ...delivery,
    });
    if (
      current.job.summary !== null &&
      view.projectionReasonCode !== "deliberation_structured_artifact_unavailable" &&
      view.projectionReasonCode !== "deliberation_structured_artifact_invalid" &&
      view.artifacts.length !== current.job.summary.artifactCount
    ) {
      throw new ProductDeliberationSourceError(
        "deliberation_source_invalid",
        "The queue artifact count differs from canonical structured history.",
      );
    }
    return view;
  } finally {
    await storage.close();
  }
}
