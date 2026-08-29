import {
  createManagedWriteDecision,
  inspectTurnResultBinding,
} from "../../packages/adapter-contract/dist/index.js";

import {
  createProviderShadowV2StructuredSelectionSchema,
  parseProviderShadowV2Selection,
  parseProviderShadowV2StructuredSelection,
  validateProviderShadowSelectionViolationCodes,
  validateProviderShadowV2Candidate,
} from "./linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import { sha256, valueDigest } from "./linked-evidence-provider-shadow-pilot-contract.mjs";
import { resolveProviderShadowSelectionProtocol } from "./linked-evidence-provider-shadow-selection-protocol.mjs";

function protocolDocument(protocolId) {
  const content = resolveProviderShadowSelectionProtocol(protocolId);
  return {
    documentId: "doc_linked_evidence_provider_shadow_protocol_v2",
    path: ".lervo/protocols/linked-evidence-provider-shadow-v2.md",
    contentHash: sha256(content),
    byteCount: Buffer.byteLength(content, "utf8"),
    scope: { kind: "full" },
    documentRole: "governance_context",
    referenceEligible: false,
    delivery: { kind: "inline", content },
  };
}

function candidateDocument(candidate, material) {
  validateProviderShadowV2Candidate(candidate);
  if (
    material === undefined ||
    typeof material.path !== "string" ||
    typeof material.text !== "string" ||
    sha256(material.text) !== candidate.contentHash ||
    Buffer.byteLength(material.text, "utf8") !== candidate.byteCount
  ) {
    throw new Error("provider_shadow_candidate_drift");
  }
  return {
    documentId: candidate.documentId,
    path: material.path,
    contentHash: candidate.contentHash,
    byteCount: candidate.byteCount,
    scope: { kind: "full" },
    documentRole: "task_evidence",
    referenceEligible: candidate.referenceEligible ?? true,
    delivery: { kind: "inline", content: material.text },
  };
}

function receiptMatches(receipt, session, envelope) {
  const expected = new Map(envelope.documents.map((document) => [document.documentId, document]));
  return (
    receipt.controlledInput === true &&
    receipt.providerSessionId === session.providerSessionId &&
    receipt.targetTurnId === envelope.targetTurnId &&
    receipt.documents.length === expected.size &&
    receipt.documents.every(
      (document) =>
        document.status === "injected" &&
        expected.get(document.documentId)?.contentHash === document.contentHash &&
        expected.get(document.documentId)?.documentRole === document.documentRole,
    )
  );
}

async function waitForTurn(adapter, session, turn, timeoutMs) {
  const controller = new AbortController();
  const observations = { tools: new Set(), commands: new Set(), usage: null, errors: 0 };
  let timer;
  const terminal = (async () => {
    for await (const event of adapter.events(session, controller.signal)) {
      if (event.type === "provider.tool.called" && event.payload.status === "completed") {
        observations.tools.add(event.payload.providerItemId);
      }
      if (event.type === "provider.command.executed" && event.payload.status === "completed") {
        observations.commands.add(event.payload.providerItemId);
      }
      if (event.type === "provider.usage.updated") observations.usage = event.payload;
      if (event.type === "provider.error") observations.errors += 1;
      if (
        event.type === "provider.turn.failed" &&
        event.payload.providerTurnId === turn.providerTurnId
      ) {
        return { observations, terminalStatus: "failed" };
      }
      if (
        event.type === "provider.turn.completed" &&
        event.payload.providerTurnId === turn.providerTurnId
      ) {
        return { observations, terminalStatus: event.payload.status };
      }
    }
    return { observations, terminalStatus: "stream_ended" };
  })();
  try {
    return await Promise.race([
      terminal,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("provider_shadow_adapter_failed")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    void terminal.catch(() => undefined);
  }
}

function failureCode(error, stopConditions) {
  const message = error instanceof Error ? error.message : "";
  return stopConditions.includes(message) ? message : "provider_shadow_adapter_failed";
}

function unavailable(input, code, lastDurableAttemptDigest, availabilityStage) {
  return {
    status: "unavailable",
    failureCode: code,
    availabilityStage,
    lastDurableAttemptDigest,
    providerInvocationCount: input.providerInvocationCount,
    adapterId: input.adapterId,
    shadowRunId: input.runSpec.shadowRunId,
    sessionId: input.runSpec.sessionId,
    providerSessionId: input.providerSessionId ?? null,
    targetTurnId: input.runSpec.targetTurnId,
    providerTurnId: input.providerTurnId ?? null,
    adapterReceiptId: input.adapterReceiptId ?? null,
    requestDigest: sha256(input.runSpec.query),
    selectionViolationCodes: validateProviderShadowSelectionViolationCodes(
      input.selectionViolationCodes ?? [],
    ),
  };
}

export async function runProviderShadowV2Turn(input) {
  const structuredSelection = input.selectionCarrier === "json_schema_e4_token_array";
  const adapter = input.createAdapter(input.provider, input.repositoryRoot, input.model, {
    structuredOutputSchema: structuredSelection
      ? createProviderShadowV2StructuredSelectionSchema(
          input.runSpec.candidates,
          input.maximumSelectedSources,
        )
      : undefined,
  });
  const requestedAt = new Date().toISOString();
  const start = Date.now();
  let session;
  let providerInvocationCount = 0;
  let providerSessionId = null;
  let adapterReceiptId = null;
  let providerTurnId = null;
  let lastDurableAttemptDigest = input.lastDurableAttemptDigest;
  let availabilityStage = "prepared";
  let stopReason = "failed";
  let outcome;
  const boundary = async (stage, coordinates) => {
    const persisted = await input.onBoundary(stage, coordinates);
    lastDurableAttemptDigest = persisted.digest;
    availabilityStage = stage;
  };

  try {
    session = await adapter.start({
      kind: "start_request",
      schemaVersion: 1,
      adapterId: adapter.descriptor.adapterId,
      projectId: input.projectId,
      runId: input.runSpec.shadowRunId,
      sessionId: input.runSpec.sessionId,
      roleId: "retrieval-benchmark",
      writingPolicyId: null,
      requestDigest: sha256(input.runSpec.query),
      executionMode: "read_only",
      requestedAt,
    });
    providerSessionId = session.providerSessionId;
    await boundary("session_started", { providerSessionId });

    const documents = [
      protocolDocument(input.selectionProtocolId ?? "linked-evidence-reconciliation-v8-selection"),
      ...input.runSpec.candidates.map((candidate) =>
        candidateDocument(candidate, input.materialByDocumentId.get(candidate.documentId)),
      ),
    ];
    const envelope = {
      kind: "context_envelope",
      schemaVersion: 1,
      envelopeId: `psenv_${input.runSpec.sampleId}`,
      adapterId: adapter.descriptor.adapterId,
      projectId: input.projectId,
      runId: input.runSpec.shadowRunId,
      sessionId: input.runSpec.sessionId,
      roleId: "retrieval-benchmark",
      writingPolicyId: null,
      writingPolicyDocumentId: null,
      targetTurnId: input.runSpec.targetTurnId,
      contextGeneration: 0,
      documents,
      createdAt: new Date().toISOString(),
    };
    const receipt = await adapter.injectContext(session, envelope);
    if (!receiptMatches(receipt, session, envelope)) {
      throw new Error("provider_shadow_adapter_failed");
    }
    adapterReceiptId = receipt.receiptId;
    await boundary("context_injected", { providerSessionId, adapterReceiptId });

    await adapter.attachManagedWriteBridge(session, {
      authorize: async (request) =>
        createManagedWriteDecision({
          request,
          decision: "deny",
          reasonCode: "capability_denied",
          decidedAt: new Date().toISOString(),
        }),
      complete: async () => {
        throw new Error("provider_shadow_primary_effect_detected");
      },
    });

    let accepted;
    let acceptancePersistence;
    const turn = await adapter.startTurn(
      session,
      {
        kind: "turn_request",
        schemaVersion: 1,
        adapterId: adapter.descriptor.adapterId,
        projectId: input.projectId,
        runId: input.runSpec.shadowRunId,
        sessionId: input.runSpec.sessionId,
        providerSessionId,
        targetTurnId: input.runSpec.targetTurnId,
        instructions: input.runSpec.query,
        requestedAt: new Date().toISOString(),
      },
      (value) => {
        accepted = structuredClone(value);
        providerInvocationCount = 1;
        providerTurnId = value.providerTurnId;
        acceptancePersistence = boundary("turn_accepted", {
          providerSessionId,
          adapterReceiptId,
          providerTurnId,
          providerInvocationCount,
        });
      },
    );
    if (acceptancePersistence !== undefined) await acceptancePersistence;
    if (
      accepted === undefined ||
      providerInvocationCount !== 1 ||
      JSON.stringify(accepted) !== JSON.stringify(turn)
    ) {
      throw new Error("provider_shadow_adapter_failed");
    }

    const terminal = await waitForTurn(adapter, session, turn, input.timeoutMs);
    await boundary("turn_completed", {
      providerSessionId,
      adapterReceiptId,
      providerTurnId,
      providerInvocationCount,
      terminalStatus: terminal.terminalStatus,
    });
    if (terminal.terminalStatus !== "completed" || terminal.observations.errors !== 0)
      throw new Error("provider_shadow_terminal_invalid");
    if (
      terminal.observations.tools.size > (input.maximumStructuredOutputFramingTools ?? 0) ||
      terminal.observations.commands.size !== 0
    )
      throw new Error("provider_shadow_tool_activity");
    if (terminal.observations.usage === null) {
      throw new Error("provider_shadow_usage_unavailable");
    }
    let result;
    try {
      result = await adapter.getTurnResult(session, turn);
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        error.code === "provider_protocol_failed"
      ) {
        throw new Error("provider_shadow_result_invalid", { cause: error });
      }
      throw error;
    }
    if (!inspectTurnResultBinding({ session, turn, result }).passed) {
      throw new Error("provider_shadow_adapter_failed");
    }
    const resultBytes = Buffer.byteLength(result.content, "utf8");
    if (resultBytes > input.maximumResultBytes) throw new Error("provider_shadow_result_oversize");
    const parsed = structuredSelection
      ? parseProviderShadowV2StructuredSelection(
          result.content,
          input.runSpec.candidates,
          input.maximumSelectedSources,
        )
      : parseProviderShadowV2Selection(
          result.content,
          input.runSpec.candidates,
          input.maximumSelectedSources,
        );
    if (!parsed.passed) {
      const error = new Error("provider_shadow_selection_invalid");
      error.selectionViolationCodes = validateProviderShadowSelectionViolationCodes(
        parsed.violations,
      );
      throw error;
    }
    stopReason = "completed";
    outcome = {
      status: "observed",
      providerInvocationCount,
      adapterId: adapter.descriptor.adapterId,
      shadowRunId: input.runSpec.shadowRunId,
      sessionId: input.runSpec.sessionId,
      providerSessionId,
      targetTurnId: input.runSpec.targetTurnId,
      providerTurnId,
      adapterReceiptId,
      requestDigest: sha256(input.runSpec.query),
      resultDigest: sha256(result.content),
      resultBytes,
      durationMs: Date.now() - start,
      usage: terminal.observations.usage,
      usageDigest: valueDigest(terminal.observations.usage),
      terminalStatus: "completed",
      structuredOutputFramingToolCount: terminal.observations.tools.size,
      selected: parsed.selected,
      lastDurableAttemptDigest,
    };
  } catch (error) {
    if (providerInvocationCount === 0) {
      if (error !== null && typeof error === "object") error.providerInvocationCount = 0;
      throw error;
    }
    const code = failureCode(error, input.stopConditions);
    outcome = unavailable(
      {
        runSpec: input.runSpec,
        providerInvocationCount,
        adapterId: adapter.descriptor.adapterId,
        providerSessionId,
        providerTurnId,
        adapterReceiptId,
        selectionViolationCodes:
          code === "provider_shadow_selection_invalid" &&
          error !== null &&
          typeof error === "object"
            ? error.selectionViolationCodes
            : [],
      },
      code,
      lastDurableAttemptDigest,
      availabilityStage,
    );
  }

  if (session !== undefined) {
    try {
      await adapter.stop(session, {
        kind: "stop_request",
        schemaVersion: 1,
        adapterId: adapter.descriptor.adapterId,
        projectId: input.projectId,
        runId: input.runSpec.shadowRunId,
        sessionId: input.runSpec.sessionId,
        providerSessionId: session.providerSessionId,
        reason: stopReason,
        requestedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (providerInvocationCount === 0) throw error;
      outcome = unavailable(
        {
          runSpec: input.runSpec,
          providerInvocationCount,
          adapterId: adapter.descriptor.adapterId,
          providerSessionId,
          providerTurnId,
          adapterReceiptId,
        },
        "provider_shadow_adapter_failed",
        lastDurableAttemptDigest,
        availabilityStage,
      );
    }
  }
  return outcome;
}
