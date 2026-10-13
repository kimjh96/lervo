import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { operatingContractHash } from "@lervo/work-controller";

import type { OutcomeSupervisionPorts } from "./outcome-supervision-ports.js";

const READINESS_CODE = /^readiness_[a-z_]+$/u;

function causationDigest(causationEventIds: readonly string[]): string {
  return operatingContractHash([...causationEventIds].sort());
}

interface Hold {
  plan: OperatingActionPlanV1;
  planHash: string;
  reasonCodes: string[];
  inputs: string;
  causation: string;
}

/**
 * Remembers a worker dispatch that its readiness gate blocked. Until the Node's readiness inputs
 * change, re-planning could only produce the same blocked dispatch, so the owner is not asked
 * again. A hold lives in this process only; a restart, which applies new Node configuration,
 * clears it.
 */
export class SupervisionReadinessHolds {
  private readonly holds = new Map<string, Hold>();

  constructor(private readonly ports: Pick<OutcomeSupervisionPorts, "readReadinessInputs">) {}

  /** Records the first readiness block of an exact dispatch; later blocks of it keep the hold. */
  async hold(
    supervisionId: string,
    plan: OperatingActionPlanV1,
    reasonCodes: readonly string[],
    causationEventIds: readonly string[],
  ): Promise<void> {
    const codes = [...new Set(reasonCodes.filter((code) => READINESS_CODE.test(code)))].sort();
    const planHash = operatingContractHash(plan);
    if (
      codes.length === 0 ||
      this.ports.readReadinessInputs === undefined ||
      this.holds.get(supervisionId)?.planHash === planHash
    )
      return;
    const inputs = await this.ports.readReadinessInputs(plan);
    if (inputs === null) return;
    this.holds.set(supervisionId, {
      plan: structuredClone(plan),
      planHash,
      reasonCodes: codes,
      inputs,
      causation: causationDigest(causationEventIds),
    });
  }

  release(supervisionId: string): void {
    this.holds.delete(supervisionId);
  }

  /**
   * The readiness reasons still holding owner planning, or null once a new cause arrived or the
   * readiness inputs of the held dispatch changed or can no longer be read.
   */
  async blocking(
    supervisionId: string,
    causationEventIds: readonly string[],
  ): Promise<string[] | null> {
    const held = this.holds.get(supervisionId);
    if (held === undefined) return null;
    if (causationDigest(causationEventIds) !== held.causation) {
      this.holds.delete(supervisionId);
      return null;
    }
    let inputs: string | null;
    try {
      inputs = (await this.ports.readReadinessInputs?.(held.plan)) ?? null;
    } catch {
      inputs = null;
    }
    if (inputs !== held.inputs) {
      this.holds.delete(supervisionId);
      return null;
    }
    return [...held.reasonCodes];
  }
}
