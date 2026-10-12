import { canonicalHash } from "@lervo/search";
import {
  bindContextQualityRequest,
  ContextQualityError,
  createContextQualityPlan,
  normalizeContextQualityIngress,
  unavailableContextQualityBindings,
  type ContextQualitySourceBytes,
} from "@lervo/context";
import type {
  ContextQualityBindings,
  ContextQualityEvidence,
  ContextQualityIngress,
  ContextQualityPlan,
  ContextQualityReadiness,
  ContextQualityRequest,
  ContextQualityReasonCode,
} from "@lervo/schemas";

export type ContextQualityBindingResolution =
  { status: "resolved"; bindings: ContextQualityBindings } | ContextQualityReadiness;

export interface ContextQualityPreparationPorts {
  resolveBindings(
    input: ContextQualityIngress,
    signal: AbortSignal,
  ): Promise<ContextQualityBindingResolution>;
  prepare(
    request: ContextQualityRequest,
    signal: AbortSignal,
  ): Promise<{
    evidence: ContextQualityEvidence;
    sources: readonly ContextQualitySourceBytes[];
  }>;
  revalidate(request: ContextQualityRequest, signal: AbortSignal): Promise<ContextQualityBindings>;
}

export type ContextQualityPreparationResult =
  | {
      requestId: string;
      status: ContextQualityPlan["status"];
      plan: ContextQualityPlan;
      reasonCodes: ContextQualityReasonCode[];
    }
  | {
      requestId: string;
      status: "unavailable" | "stale" | "cancelled";
      plan: null;
      reasonCodes: ContextQualityReasonCode[];
      missingBindings: ContextQualityReadiness["missingBindings"];
    };

/** Private application seam. Hosts must supply trusted binding owners before adopting it. */
export async function prepareContextQuality(input: {
  ingress: ContextQualityIngress;
  deadlineMs: number;
  signal: AbortSignal;
  now: () => number;
  ports: ContextQualityPreparationPorts;
}): Promise<ContextQualityPreparationResult> {
  // Reject malformed attempts before invoking any port; schema errors contain no request text.
  const ingress = normalizeContextQualityIngress(input.ingress);
  if (!Number.isSafeInteger(input.deadlineMs) || input.deadlineMs < 1 || input.deadlineMs > 600000)
    throw new ContextQualityError("context_contract_invalid");
  const controller = new AbortController();
  const started = input.now();
  let budgetMs = input.deadlineMs;
  let abortCode: ContextQualityReasonCode = "context_cancelled";
  const abort = () => controller.abort();
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = () => {
    abortCode = "context_budget_exceeded";
    controller.abort();
  };
  timer = setTimeout(timeout, budgetMs);
  const check = () => {
    if (controller.signal.aborted) throw new ContextQualityError(abortCode);
    const elapsed = input.now() - started;
    if (!Number.isFinite(elapsed) || elapsed < 0)
      throw new ContextQualityError("context_contract_invalid");
    if (elapsed >= budgetMs) throw new ContextQualityError("context_budget_exceeded");
  };
  let stopWaiting: () => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    stopWaiting = () => reject(new ContextQualityError(abortCode));
    controller.signal.addEventListener("abort", stopWaiting, { once: true });
    if (controller.signal.aborted) stopWaiting();
  });
  const work = async (): Promise<ContextQualityPreparationResult> => {
    check();
    const resolved = await input.ports.resolveBindings(structuredClone(ingress), controller.signal);
    check();
    if (resolved.status === "unavailable") {
      const missing = unavailableContextQualityBindings(resolved.missingBindings);
      return {
        requestId: ingress.requestId,
        status: "unavailable",
        plan: null,
        reasonCodes: [missing.reasonCode],
        missingBindings: missing.missingBindings,
      };
    }
    const request = bindContextQualityRequest(ingress, resolved.bindings);
    budgetMs = Math.min(budgetMs, request.profile.deadlineMs);
    check();
    clearTimeout(timer);
    timer = setTimeout(timeout, Math.max(0, budgetMs - (input.now() - started)));
    const prepared = await input.ports.prepare(structuredClone(request), controller.signal);
    check();
    // Copy and validate before the next asynchronous boundary so a port cannot alter the plan later.
    const plan = createContextQualityPlan({ request, ...prepared });
    check();
    const current = bindContextQualityRequest(
      ingress,
      await input.ports.revalidate(structuredClone(request), controller.signal),
    );
    check();
    if (
      current.semanticInputDigest !== request.semanticInputDigest ||
      canonicalHash(current.executionCapabilities) !== canonicalHash(request.executionCapabilities)
    )
      throw new ContextQualityError("context_binding_stale");
    return {
      requestId: ingress.requestId,
      status: plan.status,
      plan,
      reasonCodes: [...plan.reasonCodes],
    };
  };
  try {
    return await Promise.race([work(), cancelled]);
  } catch (error) {
    const code = error instanceof ContextQualityError ? error.code : "context_contract_invalid";
    return {
      requestId: ingress.requestId,
      status:
        code === "context_cancelled"
          ? "cancelled"
          : code === "context_binding_stale"
            ? "stale"
            : "unavailable",
      plan: null,
      reasonCodes: [code],
      missingBindings: [],
    };
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", stopWaiting);
  }
}
