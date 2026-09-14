import type { OutcomeSupervisionSnapshotV1 } from "@lervo/application-contract";
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
