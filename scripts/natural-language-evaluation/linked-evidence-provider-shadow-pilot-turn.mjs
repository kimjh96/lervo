import { randomUUID } from "node:crypto";

import {
  createManagedWriteDecision,
  inspectTurnResultBinding,
} from "../../packages/adapter-contract/dist/index.js";

import { sha256, valueDigest } from "./linked-evidence-provider-shadow-pilot-contract.mjs";
import { linkedEvidenceReconciliationV8SelectionProtocol } from "./linked-evidence-reconciliation-v8-contract.mjs";

function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function protocolDocument() {
  const content = linkedEvidenceReconciliationV8SelectionProtocol;
  return {
    documentId: "doc_linked_evidence_provider_shadow_protocol_v1",
    path: ".lervo/protocols/linked-evidence-provider-shadow-v1.md",
    contentHash: sha256(content),
    byteCount: Buffer.byteLength(content, "utf8"),
    scope: { kind: "full" },
    documentRole: "governance_context",
    referenceEligible: false,
    delivery: { kind: "inline", content },
  };
}

function candidateDocument(source) {
  return {
    documentId: source.sourceId,
    path: source.path,
    contentHash: source.contentHash,
    byteCount: Buffer.byteLength(source.text, "utf8"),
    scope: { kind: "full" },
    documentRole: "task_evidence",
    referenceEligible: true,
    delivery: { kind: "inline", content: source.text },
  };
}

export function parseProviderShadowSelection(rawContent, candidates, maximumSelectedSources) {
  const tokenByDocumentId = new Map(
    candidates.map((candidate) => {
      const documentId = candidate.documentId ?? candidate.sourceId;
      return [
        `lervo-e4:${documentId}:${candidate.contentHash}`,
        { documentId, contentHash: candidate.contentHash },
      ];
    }),
  );
  const occurrences = [...rawContent.matchAll(/(lervo-e4:[^\s<>]+)/gu)].map((match) => match[1]);
  const standalone = [
    ...rawContent.matchAll(/^[\t ]*<!--[\t ]*(lervo-e4:[^\s<>]+)[\t ]*-->[\t ]*$/gmu),
  ].map((match) => match[1]);
  const remainder = rawContent
    .replace(/^[\t ]*<!--[\t ]*lervo-e4:[^\s<>]+[\t ]*-->[\t ]*$/gmu, "")
    .trim();
  const violations = [];
  if (occurrences.length !== standalone.length) {
    violations.push("non_standalone_or_malformed_e4_marker");
  }
  if (remainder.length > 0) violations.push("provider_shadow_prose_present");
  if (standalone.some((token) => !tokenByDocumentId.has(token))) {
    violations.push("unknown_e4_marker");
  }
  if (new Set(standalone).size !== standalone.length) {
    violations.push("duplicate_e4_marker");
  }
  if (standalone.length > maximumSelectedSources) {
    violations.push("too_many_selected_sources");
  }
  const selected = standalone.flatMap((token) => {
    const candidate = tokenByDocumentId.get(token);
    return candidate === undefined
      ? []
      : [{ documentId: candidate.documentId, contentHash: candidate.contentHash }];
  });
  return { selected, violations, passed: violations.length === 0 };
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
        throw new Error("provider_shadow_adapter_failed");
      }
      if (
        event.type === "provider.turn.completed" &&
        event.payload.providerTurnId === turn.providerTurnId
      ) {
        if (event.payload.status !== "completed") {
          throw new Error("provider_shadow_adapter_failed");
        }
        return observations;
      }
    }
    throw new Error("provider_shadow_adapter_failed");
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

export async function runProviderShadowTurn(input) {
  const adapter = input.createAdapter(input.repositoryRoot, input.model);
  const runId = id("run");
  const sessionId = id("ses");
  const targetTurnId = id("psturn");
  const requestedAt = new Date().toISOString();
  const start = Date.now();
  let session;
  let stopReason = "failed";
  let providerInvocationCount = 0;
  try {
    session = await adapter.start({
      kind: "start_request",
      schemaVersion: 1,
      adapterId: adapter.descriptor.adapterId,
      projectId: input.projectId,
      runId,
      sessionId,
      roleId: "retrieval-benchmark",
      writingPolicyId: null,
      requestDigest: sha256(input.query),
      executionMode: "read_only",
      requestedAt,
    });
    const documents = [protocolDocument(), ...input.candidateSources.map(candidateDocument)];
    const envelope = {
      kind: "context_envelope",
      schemaVersion: 1,
      envelopeId: id("psenv"),
      adapterId: adapter.descriptor.adapterId,
      projectId: input.projectId,
      runId,
      sessionId,
      roleId: "retrieval-benchmark",
      writingPolicyId: null,
      writingPolicyDocumentId: null,
      targetTurnId,
      contextGeneration: 0,
      documents,
      createdAt: new Date().toISOString(),
    };
    const receipt = await adapter.injectContext(session, envelope);
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
    const turn = await adapter.startTurn(
      session,
      {
        kind: "turn_request",
        schemaVersion: 1,
        adapterId: adapter.descriptor.adapterId,
        projectId: input.projectId,
        runId,
        sessionId,
        providerSessionId: session.providerSessionId,
        targetTurnId,
        instructions: input.query,
        requestedAt: new Date().toISOString(),
      },
      (value) => {
        accepted = structuredClone(value);
      },
    );
    providerInvocationCount = 1;
    if (accepted === undefined || JSON.stringify(accepted) !== JSON.stringify(turn)) {
      throw new Error("provider_shadow_adapter_failed");
    }
    const observed = await waitForTurn(adapter, session, turn, input.timeoutMs);
    if (observed.tools.size !== 0 || observed.commands.size !== 0 || observed.errors !== 0) {
      throw new Error("provider_shadow_result_invalid");
    }
    if (observed.usage === null) throw new Error("provider_shadow_usage_unavailable");
    const result = await adapter.getTurnResult(session, turn);
    if (!inspectTurnResultBinding({ session, turn, result }).passed) {
      throw new Error("provider_shadow_adapter_failed");
    }
    const resultBytes = Buffer.byteLength(result.content, "utf8");
    if (resultBytes > input.maximumResultBytes) {
      throw new Error("provider_shadow_result_invalid");
    }
    const parsed = parseProviderShadowSelection(
      result.content,
      input.candidateSources,
      input.maximumSelectedSources,
    );
    if (!parsed.passed) throw new Error("provider_shadow_result_invalid");
    stopReason = "completed";
    return {
      providerInvocationCount,
      adapterId: adapter.descriptor.adapterId,
      shadowRunId: runId,
      sessionId,
      providerSessionId: session.providerSessionId,
      targetTurnId,
      providerTurnId: turn.providerTurnId,
      adapterReceiptId: receipt.receiptId,
      requestDigest: sha256(input.query),
      resultDigest: sha256(result.content),
      resultBytes,
      durationMs: Date.now() - start,
      usage: observed.usage,
      usageDigest: valueDigest(observed.usage),
      terminalStatus: "completed",
      selected: parsed.selected,
    };
  } catch (error) {
    if (error !== null && typeof error === "object") {
      error.providerInvocationCount = providerInvocationCount;
    }
    throw error;
  } finally {
    if (session !== undefined) {
      await adapter.stop(session, {
        kind: "stop_request",
        schemaVersion: 1,
        adapterId: adapter.descriptor.adapterId,
        projectId: input.projectId,
        runId,
        sessionId,
        providerSessionId: session.providerSessionId,
        reason: stopReason,
        requestedAt: new Date().toISOString(),
      });
    }
  }
}
