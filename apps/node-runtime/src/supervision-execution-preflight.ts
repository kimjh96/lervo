import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { SupervisionPreflightError, type OutcomeSupervisionPorts } from "@lervo/orchestrator";
import { operatingReadinessKind, reviewOperatingAction } from "@lervo/work-controller";
import { NodeSupervisionError } from "./supervision-authority.js";
import type { readNodeDispatchPreflight } from "./supervision-dispatch-readiness.js";
import { assertNodeSupervisionReadiness } from "./supervision-readiness.js";
import type { NodeSupervisionSession } from "./supervision-session.js";

/** Classifies only checks completed before the concrete effect adapter is called. */
export async function prepareNodeSupervisionEffect(input: {
  plan: OperatingActionPlanV1;
  now(): string;
  readOwnerControlReadiness: NonNullable<OutcomeSupervisionPorts["readOwnerControlReadiness"]>;
  readDispatchPreflight(): ReturnType<typeof readNodeDispatchPreflight>;
  readAdmission: OutcomeSupervisionPorts["readAdmission"];
  session(): NodeSupervisionSession;
  authorityDigest(): string | undefined;
}) {
  try {
    const { plan } = input;
    if (operatingReadinessKind(plan) === "owner_control")
      await input.readOwnerControlReadiness(plan);
    const preflight =
      operatingReadinessKind(plan) === "worker" ? await input.readDispatchPreflight() : null;
    const readiness = preflight?.readiness ?? null;
    const snapshot = preflight?.admission ?? (await input.readAdmission(plan));
    const age = Date.parse(input.now()) - Date.parse(snapshot.observedAt);
    const owner = input.session();
    const installation = await owner.readMandate();
    const review = reviewOperatingAction({ mandate: installation.mandate, plan, snapshot });
    if (!Number.isFinite(age) || age < 0 || age > 5000 || review.disposition !== "admitted")
      throw new NodeSupervisionError("supervision_authority_changed");
    if (readiness !== null)
      assertNodeSupervisionReadiness({
        readiness,
        sourceRevisionDigest: snapshot.sourceRevisionDigest,
        now: input.now(),
      });
    const authorityDigest = input.authorityDigest();
    if (authorityDigest === undefined)
      throw new NodeSupervisionError("supervision_authority_unavailable");
    return { owner, review, authorityDigest };
  } catch (cause) {
    throw new SupervisionPreflightError({ cause });
  }
}
