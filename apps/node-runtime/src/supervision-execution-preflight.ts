import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { SupervisionPreflightInspectionV1 } from "@lervo/application-contract";
import { SupervisionPreflightError, type OutcomeSupervisionPorts } from "@lervo/orchestrator";
import {
  operatingContractHash,
  operatingReadinessKind,
  reviewOperatingAction,
} from "@lervo/work-controller";
import { NodeSupervisionError } from "./supervision-authority.js";
import type { readNodeDispatchPreflight } from "./supervision-dispatch-readiness.js";
import { assertNodeSupervisionReadiness } from "./supervision-readiness.js";
import type { NodeSupervisionSession } from "./supervision-session.js";

type PreflightInput = Parameters<typeof preflightOnce>[0];

/**
 * Classifies only checks completed before the concrete effect adapter is called. An unclassified
 * failure, such as an observation that changed while it was read, is retried once before it
 * becomes a durable block; a real change of authority or readiness fails again.
 */
export async function prepareNodeSupervisionEffect(input: PreflightInput) {
  try {
    return await preflightOnce(input);
  } catch (error) {
    if (
      !(error instanceof SupervisionPreflightError) ||
      error.inspection?.reasonCode !== "preflight_cause_unclassified"
    )
      throw error;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return preflightOnce(input);
  }
}

async function preflightOnce(input: {
  plan: OperatingActionPlanV1;
  now(): string;
  readOwnerControlReadiness: NonNullable<OutcomeSupervisionPorts["readOwnerControlReadiness"]>;
  readDispatchPreflight(): ReturnType<typeof readNodeDispatchPreflight>;
  readAdmission: OutcomeSupervisionPorts["readAdmission"];
  session(): NodeSupervisionSession;
  authorityDigest(): string | undefined;
}) {
  let failurePhase: SupervisionPreflightInspectionV1["failurePhase"] = "authority";
  let finalAdmission: SupervisionPreflightInspectionV1["finalAdmission"] = null;
  let finalReadiness: SupervisionPreflightInspectionV1["finalReadiness"] = null;
  try {
    const { plan } = input;
    const owner = input.session();
    const installation = await owner.readMandate();
    if (operatingReadinessKind(plan) === "owner_control")
      await input.readOwnerControlReadiness(plan);
    failurePhase = "readiness";
    const preflight =
      operatingReadinessKind(plan) === "worker" ? await input.readDispatchPreflight() : null;
    const readiness = preflight?.readiness ?? null;
    if (readiness !== null) {
      const observation = readiness.observation;
      finalReadiness = {
        observationHash: operatingContractHash(observation),
        observedAt: observation.observedAt,
        validUntil: observation.validUntil,
        failedCheckKinds: observation.checks
          .filter((check) => check.status === "failed")
          .map((check) => check.kind),
        unobservedCheckKinds: observation.checks
          .filter((check) => check.status === "unobserved")
          .map((check) => check.kind),
      };
    }
    failurePhase = "admission";
    const snapshot = preflight?.admission ?? (await input.readAdmission(plan));
    finalAdmission = {
      snapshotHash: operatingContractHash(snapshot),
      observedAt: snapshot.observedAt,
      disposition: null,
    };
    const age = Date.parse(input.now()) - Date.parse(snapshot.observedAt);
    const review = reviewOperatingAction({ mandate: installation.mandate, plan, snapshot });
    finalAdmission.disposition = review.disposition;
    if (!Number.isFinite(age) || age < 0 || age > 5000)
      throw new NodeSupervisionError("supervision_admission_stale");
    if (review.disposition !== "admitted")
      throw new NodeSupervisionError("supervision_admission_rejected");
    failurePhase = "readiness";
    if (readiness !== null)
      assertNodeSupervisionReadiness({
        readiness,
        sourceRevisionDigest: snapshot.sourceRevisionDigest,
        now: input.now(),
      });
    failurePhase = "authority";
    const authorityDigest = input.authorityDigest();
    if (authorityDigest === undefined)
      throw new NodeSupervisionError("supervision_authority_unavailable");
    return { owner, review, authorityDigest };
  } catch (cause) {
    const code = (cause as { code?: unknown } | null)?.code;
    const reasonCode =
      typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
        ? code
        : "preflight_cause_unclassified";
    throw new SupervisionPreflightError({
      cause,
      inspection: {
        schemaVersion: 1,
        kind: "work.supervision.preflight_inspection",
        failurePhase,
        reasonCode,
        finalAdmission,
        finalReadiness,
      },
    });
  }
}
