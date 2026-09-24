import type { OutcomeSupervisionSnapshotV1 } from "@lervo/application-contract";
import { operatingContractHash, operatingEffectAdmissionHash } from "@lervo/work-controller";
import { describe, expect, it, vi } from "vitest";
import type {
  OutcomeSupervisionPorts,
  SupervisionDecisionReceipt,
} from "../src/outcome-supervision-ports.js";
import { OutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionPreflightError } from "../src/outcome-supervision-ports.js";
import {
  hash,
  mandate,
  now,
  owner,
  plan,
  snapshot,
  readiness,
  responsibility,
} from "./outcome-supervision.fixture.js";

function fixture() {
  const proposal = plan();
  const state: OutcomeSupervisionSnapshotV1 = {
    schemaVersion: 1,
    supervisionId: proposal.supervisionId,
    projectId: proposal.projectId,
    workstreamId: proposal.workstreamId,
    workstreamRevision: 1,
    sourceRevisionDigest: proposal.sourceRevisionDigest,
    ownerAgentId: owner,
    mandateHash: proposal.mandateHash,
    causationEventIds: proposal.causationEventIds,
    evidenceStatus: "valid",
    workstreamStatus: "active",
    authorityStatus: "active",
    escalationCount: 0,
    pendingDecision: false,
    delivery: "not_attempted",
    assignments: [
      {
        assignmentId: `asn_${"a".repeat(24)}`,
        revision: 1,
        executorAgentId: owner,
        acceptanceOwnerAgentId: owner,
        responsibilityArtifactHash: hash(),
        status: "queued",
        dispatchedAt: null,
        startedAt: null,
        startDeadline: "2026-09-11T03:05:00.000Z",
        progressDeadline: "2026-09-11T03:15:00.000Z",
        completionDeadline: proposal.deadline,
        terminalEventId: null,
        effectDisposition: "not_started",
        recoveryDecisionCount: 0,
        artifactHashes: [],
        requiredVerificationSuiteIds: ["save.restart"],
        verification: [],
        review: null,
        acceptanceHash: hash(),
      },
    ],
  };
  const decisions = new Map<string, SupervisionDecisionReceipt>();
  const plans = new Map<string, ReturnType<typeof plan>>();
  let leased = false;
  const execute = vi.fn(async () => ({ eventIds: [`evt_${"b".repeat(32)}`] }));
  const propose = vi.fn(async () => proposal);
  const attention = vi.fn(async () => undefined);
  const ports: OutcomeSupervisionPorts = {
    now: () => now,
    withOwnerLease: async (_id, operation) => {
      if (leased) return null;
      leased = true;
      try {
        return await operation();
      } finally {
        leased = false;
      }
    },
    readSnapshot: async () => structuredClone(state),
    readMandate: async () => mandate(),
    readAdmission: async () => ({ ...snapshot(), observedAt: ports.now() }),
    readWorkerReadiness: async () => ({
      responsibility: responsibility(),
      observation: readiness(),
      requiredChecks: ["write_scope"],
    }),
    propose,
    findPendingPlan: async () => [...plans.values()][0] ?? null,
    recordDecision: async (action, review) => {
      const receipt: SupervisionDecisionReceipt = {
        decisionId: review.decisionId,
        planHash: review.planHash,
        status: "recorded",
        effectEventIds: [],
      };
      decisions.set(receipt.decisionId, receipt);
      plans.set(receipt.decisionId, structuredClone(action));
      return receipt;
    },
    findDecision: async (id) => decisions.get(id) ?? null,
    inspectEffect: async (_plan, receipt) =>
      receipt.status === "effect_confirmed"
        ? { status: "confirmed", eventIds: receipt.effectEventIds }
        : { status: "uncertain" },
    execute,
    recordEffect: async (receipt) => {
      decisions.set(receipt.decisionId, receipt);
    },
    recordAttention: attention,
  };
  return { ports, execute, propose, attention, decisions, state };
}

describe("serialized causal owner decisions", () => {
  it("observes pre-existing bound work at startup without treating it as a fresh trigger", async () => {
    const f = fixture();
    f.propose.mockImplementation(async () => ({
      ...plan(),
      sourceRevisionDigest: f.state.sourceRevisionDigest,
    }));
    f.ports.readAdmission = async (action) => ({
      ...snapshot(),
      sourceRevisionDigest: action.sourceRevisionDigest,
      effectAdmissionHash: operatingEffectAdmissionHash(action),
    });
    f.ports.readWorkerReadiness = async () => ({
      responsibility: responsibility(),
      observation: { ...readiness(), sourceRevisionDigest: f.state.sourceRevisionDigest },
      requiredChecks: ["write_scope"],
    });
    const runtime = new OutcomeSupervisionRuntime({
      ...f.ports,
      deferInitialActionUntilChange: true,
    });

    expect((await runtime.runCycle(f.state.supervisionId)).disposition).toBe("idle");
    expect(f.propose).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();

    f.state.sourceRevisionDigest = hash("f");
    expect((await runtime.runCycle(f.state.supervisionId)).disposition).toBe("effect_confirmed");
    expect(f.propose).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
  });

  it.each(["leased", "dispatched"] as const)(
    "resumes a durable %s assignment at startup without a new source revision",
    async (state) => {
      const f = fixture();
      if (state === "leased") f.state.assignments[0]!.status = "leased";
      else {
        f.state.assignments[0]!.dispatchedAt = now;
        f.ports.now = () => "2026-09-11T03:06:00.000Z";
      }
      const propose = vi.fn(async () => null);
      const runtime = new OutcomeSupervisionRuntime({
        ...f.ports,
        propose,
        deferInitialActionUntilChange: true,
      });

      expect((await runtime.runCycle(f.state.supervisionId)).disposition).toBe("blocked");
      expect(propose).toHaveBeenCalledOnce();
      expect(f.attention).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonCode: state === "leased" ? "ready_for_dispatch_review" : "worker_deadline_elapsed",
        }),
        ["owner_plan_unavailable"],
      );
      expect(f.execute).not.toHaveBeenCalled();
      // The unchanged source stays blocked instead of reading as idle and hiding its attention.
      expect(await runtime.runCycle(f.state.supervisionId)).toEqual({
        disposition: "blocked",
        report: null,
      });
      expect(propose).toHaveBeenCalledOnce();
    },
  );

  it("requires independent non-start evidence before retrying a failed preflight", async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(new SupervisionPreflightError());
    const runtime = new OutcomeSupervisionRuntime(f.ports);
    expect((await runtime.runCycle(f.state.supervisionId)).disposition).toBe("blocked");
    expect([...f.decisions.values()][0]!.status).toBe("recorded");
    f.state.pendingDecision = true;
    const restarted = new OutcomeSupervisionRuntime(f.ports);
    expect((await restarted.runCycle(f.state.supervisionId)).disposition).toBe("uncertain");
    expect(f.execute).toHaveBeenCalledOnce();
    f.ports.inspectEffect = async () => ({ status: "not_started" });
    expect((await restarted.runCycle(f.state.supervisionId)).disposition).toBe("effect_confirmed");
    expect(f.execute).toHaveBeenCalledTimes(2);
    expect(f.propose).toHaveBeenCalledOnce();
  });

  it("records a witnessed non-start and does not replan through an unresolved barrier", async () => {
    const f = fixture();
    const inspection = {
      schemaVersion: 1 as const,
      kind: "work.supervision.preflight_inspection" as const,
      failurePhase: "readiness" as const,
      reasonCode: "supervision_readiness_stale",
      finalAdmission: null,
      finalReadiness: null,
    };
    const record = vi.fn(async () => undefined);
    f.ports.recordPreflightBlocked = record;
    f.execute.mockRejectedValueOnce(new SupervisionPreflightError({ inspection }));
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("blocked");
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: "recorded" }),
      expect.objectContaining({ effectContract: plan().effectContract }),
      inspection,
    );
    f.ports.findPendingPlan = async () => null;
    f.ports.hasUnresolvedPreflightBlock = async () => true;
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("blocked");
    expect(f.propose).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.attention).toHaveBeenCalledWith(expect.anything(), [
      "preflight_repair_requires_review",
    ]);
  });

  it("does not treat an effect error with a matching code as proof that execution never started", async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(
      Object.assign(new Error("Response lost after execution."), {
        code: "supervision_preflight_failed",
      }),
    );
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("uncertain");
    expect([...f.decisions.values()][0]!.status).toBe("uncertain");
  });

  it("reconciles cancellation independently of expired resource admission without proposing work", async () => {
    const f = fixture();
    f.state.workstreamStatus = "cancelled";
    f.state.authorityStatus = "expired";
    f.ports.now = () => "2026-09-13T00:00:00.000Z";
    const admission = vi.fn(async () => {
      throw new Error("No new admission during cancellation.");
    });
    f.ports.readAdmission = admission;
    const reconcile = vi.fn(async () => ({ eventIds: [`evt_${"c".repeat(32)}`] }));
    f.ports.reconcileCancellation = reconcile;
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("changed");
    expect(reconcile).toHaveBeenCalledOnce();
    expect(f.propose).not.toHaveBeenCalled();
    expect(f.execute).not.toHaveBeenCalled();
    expect(admission).not.toHaveBeenCalled();
  });

  it("inspects unresolved provider effects before cancellation cleanup", async () => {
    const f = fixture();
    f.ports.execute = async () => {
      throw new Error("Uncertain provider effect.");
    };
    const runtime = new OutcomeSupervisionRuntime(f.ports);
    expect((await runtime.runCycle(f.state.supervisionId)).disposition).toBe("uncertain");
    f.state.workstreamStatus = "cancelled";
    f.state.sourceRevisionDigest = hash("f");
    const reconcile = vi.fn(async () => ({ eventIds: [`evt_${"c".repeat(32)}`] }));
    f.ports.reconcileCancellation = reconcile;
    expect((await runtime.runCycle(f.state.supervisionId)).disposition).toBe("uncertain");
    expect(reconcile).not.toHaveBeenCalled();
    expect(f.propose).toHaveBeenCalledOnce();
  });

  it.each([true, false])(
    "requires canonical supersession evidence after an absence adapter returns success (%s)",
    async (recorded) => {
      const f = fixture();
      let reads = 0;
      f.ports.readAdmission = async () => ({ ...snapshot(), revoked: ++reads > 1 });
      expect(
        (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
      ).toBe("changed");
      f.state.sourceRevisionDigest = hash("f");
      f.ports.inspectEffect = async () => ({ status: "not_started" });
      f.ports.supersedeNotStarted = async () => {
        if (recorded)
          for (const [id, receipt] of f.decisions)
            f.decisions.set(id, { ...receipt, status: "superseded" });
        return true;
      };
      const cycle = new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId);
      if (recorded) expect((await cycle).disposition).toBe("changed");
      else await expect(cycle).rejects.toThrow("canonical decision evidence");
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.propose).toHaveBeenCalledTimes(1);
    },
  );
  it("supersedes a deadline-expired uncertain decision only after exact non-start proof", async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(
      new Error("The launched child exited without dispatch evidence."),
    );
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("uncertain");
    f.ports.now = () => "2026-09-11T03:31:00.000Z";
    const supersede = vi.fn(async () => {
      for (const [id, receipt] of f.decisions)
        f.decisions.set(id, { ...receipt, status: "superseded" });
      return true;
    });
    f.ports.supersedeNotStarted = supersede;
    f.ports.inspectEffect = async () => ({ status: "uncertain" });
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("uncertain");
    expect(supersede).not.toHaveBeenCalled();
    f.ports.inspectEffect = async () => ({ status: "not_started" });
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("changed");
    expect(supersede).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it("reports an uncertain effect failure and supersedes it once its start deadline passes", async () => {
    const f = fixture();
    const failure = new Error("The claim role or resource evidence changed before commit.");
    f.execute.mockRejectedValueOnce(failure);
    const reported = vi.fn();
    f.ports.reportEffectFailure = reported;
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("uncertain");
    expect(reported).toHaveBeenCalledWith(
      expect.objectContaining({ supervisionId: f.state.supervisionId }),
      failure,
    );
    const supersede = vi.fn(async () => {
      for (const [id, receipt] of f.decisions)
        f.decisions.set(id, { ...receipt, status: "superseded" });
      return true;
    });
    f.ports.supersedeNotStarted = supersede;
    f.ports.inspectEffect = async () => ({ status: "not_started" });
    f.ports.readEffectStartDeadline = async () => f.ports.now();
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("changed");
    expect(supersede).toHaveBeenCalledOnce();
    expect(f.execute).toHaveBeenCalledOnce();
  });
  it("reconciles an old-source uncertain effect before proposing new work, including after revocation", async () => {
    const f = fixture();
    f.execute.mockRejectedValueOnce(new Error("effect_response_lost"));
    await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId);
    f.state.sourceRevisionDigest = hash("f");
    f.state.authorityStatus = "revoked";
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("uncertain");
    expect(f.propose).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledTimes(1);
    f.ports.inspectEffect = async () => ({
      status: "confirmed",
      eventIds: [`evt_${"b".repeat(32)}`],
    });
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("effect_confirmed");
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("blocks dispatch when a worker cannot save despite an admitted operating plan", async () => {
    const f = fixture();
    const observation = readiness();
    observation.checks.find((check) => check.kind === "write_scope")!.status = "failed";
    f.ports.readWorkerReadiness = async () => ({
      responsibility: responsibility(),
      observation,
      requiredChecks: ["write_scope"],
    });
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("blocked");
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.attention).toHaveBeenCalledWith(expect.anything(), ["readiness_write_scope_failed"]);
  });
  it("records one canonical readiness failure and resumes the same decision after repair", async () => {
    const f = new Map();
    const fx = fixture();
    const failed = readiness();
    failed.checks.find((check) => check.kind === "provider")!.status = "failed";
    let repaired = false;
    fx.ports.readWorkerReadiness = async () => ({
      responsibility: responsibility(),
      observation: repaired ? readiness() : failed,
      requiredChecks: ["provider"],
    });
    const recorded = vi.fn(async (receipt: SupervisionDecisionReceipt, failure) => {
      f.set(`${receipt.decisionId}:${operatingContractHash(failure.observation.checks)}`, failure);
    });
    fx.ports.recordReadinessFailure = recorded;
    fx.ports.inspectEffect = async () => ({ status: "not_started" });
    const runtime = new OutcomeSupervisionRuntime(fx.ports);
    expect((await runtime.runCycle(fx.state.supervisionId)).disposition).toBe("blocked");
    expect((await runtime.runCycle(fx.state.supervisionId)).disposition).toBe("blocked");
    expect(recorded).toHaveBeenCalledTimes(2);
    expect(f.size).toBe(1);
    expect([...f.values()][0]!.reasonCodes).toEqual(["readiness_provider_failed"]);
    expect([...fx.decisions.values()][0]!.status).toBe("recorded");
    expect(fx.execute).not.toHaveBeenCalled();
    repaired = true;
    expect((await runtime.runCycle(fx.state.supervisionId)).disposition).toBe("effect_confirmed");
    expect(fx.execute).toHaveBeenCalledOnce();
    expect(fx.propose).toHaveBeenCalledOnce();
    expect(fx.decisions.size).toBe(1);
  });
  it("does not record unobserved readiness as a canonical failure", async () => {
    const fx = fixture();
    const observation = readiness();
    observation.checks.find((check) => check.kind === "provider")!.status = "unobserved";
    fx.ports.readWorkerReadiness = async () => ({
      responsibility: responsibility(),
      observation,
      requiredChecks: ["provider"],
    });
    const recorded = vi.fn(async () => undefined);
    fx.ports.recordReadinessFailure = recorded;
    expect(
      (await new OutcomeSupervisionRuntime(fx.ports).runCycle(fx.state.supervisionId)).disposition,
    ).toBe("blocked");
    expect(recorded).not.toHaveBeenCalled();
    expect(fx.attention).toHaveBeenCalledWith(expect.anything(), ["readiness_provider_unobserved"]);
  });
  it.each(["work.artifact_review.v1", "work.unknown.v1"])(
    "maps only an exact artifact review after a blocked verdict (%s)",
    async (contract) => {
      const f = fixture();
      const assignment = f.state.assignments[0]!;
      assignment.status = "completed";
      assignment.terminalEventId = `evt_${"c".repeat(32)}`;
      assignment.effectDisposition = "reconciled";
      assignment.artifactHashes = [hash("c")];
      assignment.review = {
        verdict: "blocked",
        reviewerAgentId: owner,
        acceptanceHash: assignment.acceptanceHash,
        artifactHashes: [...assignment.artifactHashes],
        verificationEventIds: [],
      };
      f.propose.mockResolvedValue({
        ...plan(),
        actionKind: "execute_as_owner",
        effectContract: contract as ReturnType<typeof plan>["effectContract"],
      });
      const admission = vi.fn(async () => {
        throw new Error("Reached independent admission after effect mapping.");
      });
      f.ports.readAdmission = admission;
      const cycle = new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId);
      if (contract === "work.artifact_review.v1") {
        await expect(cycle).rejects.toThrow("Reached independent admission");
        expect(admission).toHaveBeenCalledOnce();
        expect(f.attention).not.toHaveBeenCalled();
      } else {
        expect((await cycle).disposition).toBe("blocked");
        expect(admission).not.toHaveBeenCalled();
        expect(f.attention).toHaveBeenCalledWith(expect.anything(), ["effect_mapping_unavailable"]);
      }
    },
  );
  it("executes once, does no idle model work, and reconciles after runtime restart", async () => {
    const f = fixture();
    const runtime = new OutcomeSupervisionRuntime(f.ports);
    expect((await runtime.runCycle(f.state.supervisionId)).disposition).toBe("effect_confirmed");
    expect((await runtime.runCycle(f.state.supervisionId)).disposition).toBe("idle");
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("effect_confirmed");
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.propose).toHaveBeenCalledTimes(1);
  });
  it("suppresses concurrent owners using the common lease", async () => {
    const f = fixture();
    const results = await Promise.all([
      new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId),
      new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId),
    ]);
    expect(results.map((item) => item.disposition).sort()).toEqual(["busy", "effect_confirmed"]);
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it("rechecks revocation after durable decision recording and before the effect", async () => {
    const f = fixture();
    let reads = 0;
    f.ports.readAdmission = async () => ({ ...snapshot(), revoked: ++reads > 1 });
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("changed");
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.attention).toHaveBeenCalledWith(expect.anything(), ["mandate_revoked"]);
  });
  it("persists uncertain effects and never retries them blindly after restart", async () => {
    const f = fixture();
    f.execute.mockRejectedValue(new Error("Connection lost after dispatch."));
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("uncertain");
    expect([...f.decisions.values()][0]!.status).toBe("uncertain");
    expect(
      (await new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId)).disposition,
    ).toBe("uncertain");
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.propose).toHaveBeenCalledTimes(1);
  });
  it("refuses a planner proposal that widens its causal owner binding", async () => {
    const f = fixture();
    f.propose.mockResolvedValue({ ...plan(), ownerAgentId: `agt_${"b".repeat(24)}` });
    await expect(
      new OutcomeSupervisionRuntime(f.ports).runCycle(f.state.supervisionId),
    ).rejects.toThrow("causal source");
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("honors persisted start deadlines without a new event or a chat reply", async () => {
    const f = fixture();
    f.state.assignments[0]!.dispatchedAt = now;
    const runtime = new OutcomeSupervisionRuntime(f.ports);
    expect((await runtime.runCycle(f.state.supervisionId)).report?.status).toBe("awaiting_start");
    expect(f.propose).not.toHaveBeenCalled();
    f.ports.now = () => "2026-09-11T03:06:00.000Z";
    f.propose.mockResolvedValue({ ...plan(), actionKind: "inspect_uncertain_effect" });
    expect((await runtime.runCycle(f.state.supervisionId)).report?.reasonCode).toBe(
      "worker_deadline_elapsed",
    );
    expect(f.propose).toHaveBeenCalledOnce();
  });
});
