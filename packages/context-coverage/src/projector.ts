import {
  type ContextScope,
  type EventEnvelope,
  type ManagedContextCoverageReport,
  type ManagedContextDocumentCoverage,
  validateSchema,
} from "@lervo/schemas";

export class ManagedContextCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedContextCoverageError";
  }
}

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManagedContextCoverageError("Managed context event payload is not an object.");
  }
  return value as JsonRecord;
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ManagedContextCoverageError("Managed context event text coordinate is missing.");
  }
  return value;
}

function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ManagedContextCoverageError("Managed context event integer coordinate is invalid.");
  }
  return value as number;
}

function scope(value: unknown): ContextScope {
  const candidate = object(value);
  if (candidate.kind === "full") return { kind: "full" };
  if (
    candidate.kind === "sections" && Array.isArray(candidate.sections) &&
    candidate.sections.length > 0 && candidate.sections.every((item) => typeof item === "string")
  ) return { kind: "sections", sections: [...candidate.sections] as string[] };
  throw new ManagedContextCoverageError("Managed context scope is invalid.");
}

function scopeKey(value: ContextScope): string {
  return value.kind === "full" ? "full" : `sections:${[...value.sections].sort().join("\0")}`;
}

function versionKey(documentId: string, contentHash: string, value: ContextScope): string {
  return `${documentId}\0${contentHash}\0${scopeKey(value)}`;
}

function ratio(
  numerator: number,
  denominator: number,
  reason: string | null = null,
): ManagedContextCoverageReport["coverage"]["delivery"] {
  return {
    numerator,
    denominator,
    value: reason === null && denominator > 0 ? numerator / denominator : null,
    reason: reason ?? (denominator === 0 ? "denominator_empty" : null),
  };
}

interface VersionState {
  documentId: string;
  contentHash: string;
  scope: ContextScope;
  loadedEventIds: string[];
  sourceRevisions: string[];
  deliveries: ManagedContextDocumentCoverage["deliveries"];
  references: ManagedContextDocumentCoverage["references"];
}

function eventStatus(events: readonly EventEnvelope[]): ManagedContextCoverageReport["status"] {
  const types = new Set(events.map((event) => event.type));
  return types.has("run.failed") ? "failed" : types.has("run.completed") ? "completed" : "incomplete";
}

export function projectManagedContextCoverage(
  events: readonly EventEnvelope[],
): ManagedContextCoverageReport | null {
  if (events.length === 0) return null;
  const adapterStarts = events.filter((event) => event.type === "adapter.started");
  if (adapterStarts.length === 0) return null;
  const projectId = events[0]!.projectId;
  const runId = events[0]!.runId;
  if (events.some((event) => event.projectId !== projectId || event.runId !== runId)) {
    throw new ManagedContextCoverageError("Managed coverage events cross project or run coordinates.");
  }
  const providers = new Set(adapterStarts.map((event) => string(event.actor.provider)));
  if (providers.size !== 1) {
    throw new ManagedContextCoverageError("Managed coverage requires exactly one provider per run.");
  }
  const provider = [...providers][0]!;

  const selections = new Map<string, ManagedContextDocumentCoverage["selectionReasons"]>();
  const requiredDocuments = new Set<string>();
  for (const event of events.filter((candidate) => candidate.type === "context.selected")) {
    const payload = object(event.payload);
    const documentId = string(payload.documentId);
    const required = payload.required === true;
    const reasons = selections.get(documentId) ?? [];
    reasons.push({
      eventId: event.eventId,
      reasonCode: string(payload.reasonCode),
      ruleId: string(payload.ruleId),
      required,
      scope: scope(payload.scope),
    });
    selections.set(documentId, reasons);
    if (required) requiredDocuments.add(documentId);
  }

  const versions = new Map<string, VersionState>();
  const versionKeysByDocument = new Map<string, string[]>();
  for (const event of events.filter((candidate) => candidate.type === "document.loaded")) {
    const payload = object(event.payload);
    const documentId = string(payload.documentId);
    const contentHash = string(payload.contentHash);
    const documentScope = scope(payload.scope);
    const key = versionKey(documentId, contentHash, documentScope);
    const current = versions.get(key) ?? {
      documentId,
      contentHash,
      scope: documentScope,
      loadedEventIds: [],
      sourceRevisions: [],
      deliveries: [],
      references: [],
    };
    current.loadedEventIds.push(event.eventId);
    current.sourceRevisions.push(string(payload.sourceRevision));
    versions.set(key, current);
    const keys = versionKeysByDocument.get(documentId) ?? [];
    if (!keys.includes(key)) keys.push(key);
    versionKeysByDocument.set(documentId, keys);
  }

  const deliveriesByReceipt = new Map<string, { key: string; delivery: VersionState["deliveries"][number] }>();
  for (const event of events.filter((candidate) => candidate.type === "context.injected")) {
    const payload = object(event.payload);
    if (!Array.isArray(payload.documents)) continue;
    const evidenceIds = Array.isArray(payload.evidenceReceiptIds)
      ? payload.evidenceReceiptIds.map(string)
      : [];
    const documentIds = Array.isArray(payload.documentIds) ? payload.documentIds.map(string) : [];
    const records = payload.documents.map(object);
    if (
      records.length !== evidenceIds.length || records.length !== documentIds.length ||
      records.some((record, index) =>
        string(record.evidenceReceiptId) !== evidenceIds[index] ||
        string(record.documentId) !== documentIds[index])
    ) {
      throw new ManagedContextCoverageError("Enhanced E3 document coordinates differ from aggregate receipt arrays.");
    }
    for (const record of records) {
      const documentId = string(record.documentId);
      const contentHash = string(record.contentHash);
      const documentScope = scope(record.scope);
      const key = versionKey(documentId, contentHash, documentScope);
      const version = versions.get(key);
      if (version === undefined) {
        throw new ManagedContextCoverageError("Enhanced E3 has no matching E2 document version.");
      }
      const delivery = {
        eventId: event.eventId,
        evidenceReceiptId: string(record.evidenceReceiptId),
        adapterReceiptId: string(payload.receiptId),
        envelopeId: string(payload.envelopeId),
        providerSessionId: string(payload.providerSessionId),
        targetTurnId: string(payload.targetTurnId),
        contextGeneration: integer(payload.contextGeneration),
      };
      version.deliveries.push(delivery);
      if (deliveriesByReceipt.has(delivery.evidenceReceiptId)) {
        throw new ManagedContextCoverageError("An E3 evidence receipt is duplicated.");
      }
      deliveriesByReceipt.set(delivery.evidenceReceiptId, { key, delivery });
    }
  }

  const resultEvents = new Map(events.filter((event) => event.type === "adapter.result.captured")
    .map((event) => [event.eventId, event]));
  for (const event of events.filter((candidate) => candidate.type === "context.referenced")) {
    const payload = object(event.payload);
    const injectedReceiptId = string(payload.injectedEvidenceReceiptId);
    const injected = deliveriesByReceipt.get(injectedReceiptId);
    const source = resultEvents.get(string(payload.sourceEventId));
    if (injected === undefined || source === undefined) {
      throw new ManagedContextCoverageError("E4 has no matching E3 receipt or captured result event.");
    }
    const sourcePayload = object(source.payload);
    const version = versions.get(injected.key)!;
    const expectedCitation = `lervo-e4:${version.documentId}:${version.contentHash}`;
    if (
      string(payload.documentId) !== version.documentId ||
      string(payload.contentHash) !== version.contentHash ||
      scopeKey(scope(payload.scope)) !== scopeKey(version.scope) ||
      string(payload.adapterReceiptId) !== injected.delivery.adapterReceiptId ||
      string(payload.providerSessionId) !== injected.delivery.providerSessionId ||
      string(payload.targetTurnId) !== injected.delivery.targetTurnId ||
      integer(payload.contextGeneration) !== injected.delivery.contextGeneration ||
      string(payload.provider) !== provider || event.actor.provider !== provider ||
      string(payload.providerTurnId) !== string(sourcePayload.providerTurnId) ||
      string(payload.targetTurnId) !== string(sourcePayload.targetTurnId) ||
      string(payload.providerSessionId) !== string(sourcePayload.providerSessionId) ||
      string(payload.citation) !== expectedCitation || payload.referenceKind !== "output_citation"
    ) {
      throw new ManagedContextCoverageError("E4 does not match its exact E3 version and source result coordinates.");
    }
    version.references.push({
      eventId: event.eventId,
      sourceEventId: source.eventId,
      evidenceReceiptId: string(payload.evidenceReceiptId),
      injectedEvidenceReceiptId: injectedReceiptId,
      referenceKind: "output_citation",
      citation: expectedCitation,
      targetTurnId: string(payload.targetTurnId),
      providerTurnId: string(payload.providerTurnId),
      contextGeneration: integer(payload.contextGeneration),
    });
  }

  const documents: ManagedContextDocumentCoverage[] = [];
  for (const [documentId, keys] of versionKeysByDocument) {
    for (const key of keys) {
      const version = versions.get(key)!;
      const selectionReasons = selections.get(documentId) ?? [];
      documents.push({
        documentId,
        contentHash: version.contentHash,
        scope: version.scope,
        sourceRevisions: [...new Set(version.sourceRevisions)],
        required: selectionReasons.some((reason) => reason.required),
        highestEvidence: version.references.length > 0
          ? "referenced"
          : version.deliveries.length > 0 ? "injected" : "loaded",
        selectionReasons,
        loadedEventIds: [...new Set(version.loadedEventIds)],
        deliveries: version.deliveries,
        references: version.references,
        missingStages: [
          ...(selectionReasons.length === 0 ? ["E1" as const] : []),
          ...(version.deliveries.length === 0 ? ["E3" as const] : []),
          ...(version.references.length === 0 ? ["E4" as const] : []),
        ],
      });
    }
  }
  for (const [documentId, selectionReasons] of selections) {
    if (versionKeysByDocument.has(documentId)) continue;
    documents.push({
      documentId,
      contentHash: null,
      scope: selectionReasons[0]?.scope ?? null,
      sourceRevisions: [],
      required: selectionReasons.some((reason) => reason.required),
      highestEvidence: "selected",
      selectionReasons,
      loadedEventIds: [],
      deliveries: [],
      references: [],
      missingStages: ["E2", "E3", "E4"],
    });
  }
  documents.sort((left, right) =>
    left.documentId.localeCompare(right.documentId) ||
    String(left.contentHash).localeCompare(String(right.contentHash))
  );

  const required = documents.filter((document) => document.required);
  const unresolvedRequired = required.some((document) => document.contentHash === null);
  const deliveredRequired = required.filter((document) => document.deliveries.length > 0).length;
  const injected = documents.filter((document) => document.deliveries.length > 0);
  const referenced = injected.filter((document) => document.references.length > 0);
  const recommendedIds = new Set(events.filter((event) => event.type === "context.recommended")
    .map((event) => string(object(event.payload).documentId)));
  const selectedRecommended = [...recommendedIds].filter((documentId) => selections.has(documentId)).length;

  const report: ManagedContextCoverageReport = {
    schemaVersion: 1,
    reportKind: "managed_context",
    executionMode: "managed",
    projectId,
    runId,
    sessionIds: [...new Set(events.map((event) => event.sessionId))],
    provider,
    status: eventStatus(events),
    capabilities: {
      controlledContextDelivery: injected.length > 0 ? "observed" : "supported_no_observation",
      explicitOutputReference: referenced.length > 0
        ? "observed"
        : resultEvents.size > 0 ? "supported_no_observation" : "unavailable",
      internalUse: "unsupported",
    },
    documents,
    coverage: {
      delivery: unresolvedRequired
        ? ratio(deliveredRequired, required.length, "required_version_unresolved")
        : required.length === 0
          ? ratio(0, 0, "required_document_set_empty")
          : ratio(deliveredRequired, required.length),
      explicitReference: resultEvents.size === 0
        ? ratio(0, injected.length, "reference_telemetry_unavailable")
        : injected.length === 0
          ? ratio(0, 0, "injected_document_set_empty")
          : ratio(referenced.length, injected.length),
      relevance: ratio(0, 0, "reviewed_ground_truth_unavailable"),
      candidateSelection: recommendedIds.size === 0
        ? ratio(0, 0, "recommendations_unavailable")
        : ratio(selectedRecommended, recommendedIds.size),
    },
  };
  if (!validateSchema("managedContextCoverageReport", report).valid) {
    throw new ManagedContextCoverageError("Projected managed context coverage does not satisfy its schema.");
  }
  return report;
}
