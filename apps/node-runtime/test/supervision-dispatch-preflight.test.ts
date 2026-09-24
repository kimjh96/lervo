import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { operatingContractHash, projectOutcomeSupervision } from "@lervo/work-controller";
import { NodeSupervisionStore } from "../src/supervision-store.js";
import {
  readNodeDispatchPreflight,
  readNodeDispatchReadiness,
} from "../src/supervision-dispatch-readiness.js";
import { inspectSupervisionKnowledgeReadiness } from "../src/supervision-knowledge-readiness.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["success", "admission_failure", "probe_failure"])(
  "settles both independent final observations before returning (%s)",
  async (outcome) => {
    const f = await dispatchFixture(roots);
    const report = projectOutcomeSupervision({
      snapshot: f.observation,
      now: f.ports.now(),
      maximumRecoveryDecisions: 1,
    });
    const combined = operatingContractHash("preflight combined source");
    const plan = { ...(await f.ports.propose(report))!, sourceRevisionDigest: combined };
    const knowledge = await inspectSupervisionKnowledgeReadiness({
      repositoryRoot: f.root,
      projectId: plan.projectId,
      requiredPaths: plan.expectedPaths,
      now: f.ports.now,
    });
    const knowledgeSnapshotId = knowledge.sourceSnapshotId;
    if (knowledgeSnapshotId === null) throw new Error("The fixture has no knowledge snapshot.");
    const store = await NodeSupervisionStore.open({
      repositoryRoot: f.root,
      binding: f.binding,
      now: f.ports.now,
    });
    let enterAdmission!: () => void;
    let enterProbe!: () => void;
    const admissionEntered = new Promise<void>((resolve) => {
      enterAdmission = resolve;
    });
    const probeEntered = new Promise<void>((resolve) => {
      enterProbe = resolve;
    });
    let probeSettled = false;
    let admissionSettled = false;
    try {
      await store.withOwner(async (session) => {
        const observedSession = {
          ...session,
          readResponsibility: async (assignmentId: string) => {
            enterProbe();
            await admissionEntered;
            probeSettled = true;
            if (outcome === "probe_failure") throw new Error("probe changed");
            return session.readResponsibility(assignmentId);
          },
        };
        const pending = readNodeDispatchPreflight({
          repositoryRoot: f.root,
          plan,
          session: observedSession,
          ports: f.ports,
          configuration: f.runtimeReadiness,
          expectedKnowledgeSnapshotId: knowledgeSnapshotId,
          sourceBinding: {
            authorityDigest: operatingContractHash("preflight authority"),
            taskDigest: f.observation.sourceRevisionDigest,
            combined,
          },
          readAdmission: async () => {
            enterAdmission();
            await probeEntered;
            admissionSettled = true;
            if (outcome === "admission_failure") throw new Error("admission changed");
            return f.ports.readAdmission(plan);
          },
        });
        if (outcome === "success") {
          const result = await pending;
          expect(result.admission.sourceRevisionDigest).toBe(f.observation.sourceRevisionDigest);
          expect(result.readiness.responsibility).toEqual(f.task);
          for (const kind of [
            "provider",
            "tools",
            "verification",
            "knowledge",
            "lease",
            "ancestry",
            "workspace",
          ])
            expect(
              result.readiness.observation.checks.find((check) => check.kind === kind),
            ).toMatchObject({
              status: "passed",
              evidenceHash: expect.stringMatching(/^sha256:/u),
            });
          const { providerLoginContexts: _loginContexts, ...configurationWithoutLogin } =
            f.runtimeReadiness;
          const missingLogin = await readNodeDispatchPreflight({
            repositoryRoot: f.root,
            plan,
            session,
            ports: f.ports,
            configuration: configurationWithoutLogin,
            expectedKnowledgeSnapshotId: knowledgeSnapshotId,
            sourceBinding: {
              authorityDigest: operatingContractHash("preflight authority"),
              taskDigest: f.observation.sourceRevisionDigest,
              combined,
            },
            readAdmission: () => f.ports.readAdmission(plan),
          });
          expect(
            missingLogin.readiness.observation.checks.find((check) => check.kind === "provider"),
          ).toMatchObject({ status: "unobserved", evidenceHash: null });
          expect(
            missingLogin.readiness.observation.checks.find((check) => check.kind === "tools"),
          ).toMatchObject({ status: "passed" });
        } else {
          await expect(pending).rejects.toThrow(
            outcome === "probe_failure" ? "probe changed" : "admission changed",
          );
        }
        expect(probeSettled && admissionSettled).toBe(true);
        expect(await session.readResponsibility(f.task.assignmentId)).not.toBeNull();
      });
    } finally {
      await store.close();
    }
  },
  15000,
);

it("rejects a changed installed mandate before deriving canonical budget readiness", async () => {
  const f = await dispatchFixture(roots);
  const plan = {
    ...(await f.ports.propose(
      projectOutcomeSupervision({
        snapshot: f.observation,
        now: f.ports.now(),
        maximumRecoveryDecisions: 1,
      }),
    ))!,
    effectContract: "work.managed_execution.v1",
  };
  const { readWorkerReadiness: _readWorkerReadiness, ...canonicalPorts } = f.ports;
  const store = await NodeSupervisionStore.open({
    repositoryRoot: f.root,
    binding: f.binding,
    now: f.ports.now,
  });
  try {
    await store.withOwner(async (session) => {
      await expect(
        readNodeDispatchReadiness({
          repositoryRoot: f.root,
          plan,
          session: {
            ...session,
            readMandate: async () => ({
              ...(await session.readMandate()),
              mandateHash: operatingContractHash("changed installed mandate"),
            }),
          },
          ports: canonicalPorts,
          configuration: f.runtimeReadiness,
          sourceBinding: null,
        }),
      ).rejects.toMatchObject({ code: "supervision_binding_invalid" });
    });
  } finally {
    await store.close();
  }
});

it("keeps canonical task context fresh through the final parallel probes", async () => {
  const f = await dispatchFixture(roots);
  const combined = operatingContractHash("canonical preflight source");
  const plan = {
    ...(await f.ports.propose(
      projectOutcomeSupervision({
        snapshot: f.observation,
        now: f.ports.now(),
        maximumRecoveryDecisions: 1,
      }),
    ))!,
    sourceRevisionDigest: combined,
    effectContract: "work.managed_execution.v1",
  };
  const { readWorkerReadiness: _readWorkerReadiness, ...canonicalPorts } = f.ports;
  const store = await NodeSupervisionStore.open({
    repositoryRoot: f.root,
    binding: f.binding,
    now: f.ports.now,
  });
  try {
    await store.withOwner(async (session) => {
      const result = await readNodeDispatchReadiness({
        repositoryRoot: f.root,
        plan,
        session: {
          ...session,
          readTaskResponsibility: async () => ({
            responsibility: f.task,
            workstreamRevision: f.observation.workstreamRevision,
          }),
          readTaskAdmission: async () => f.ports.readAdmission(plan),
        },
        ports: canonicalPorts,
        configuration: f.runtimeReadiness,
        sourceBinding: {
          authorityDigest: operatingContractHash("canonical preflight authority"),
          taskDigest: f.observation.sourceRevisionDigest,
          combined,
        },
      });
      expect(
        result.readiness.observation.checks.find((check) => check.kind === "provider"),
      ).toMatchObject({ status: "passed" });
      expect(
        Date.parse(f.ports.now()) - Date.parse(result.readiness.observation.observedAt),
      ).toBeLessThanOrEqual(5000);
      const initialAdmission = await f.ports.readAdmission(plan);
      let admissionReads = 0;
      await expect(
        readNodeDispatchReadiness({
          repositoryRoot: f.root,
          plan,
          session: {
            ...session,
            readTaskResponsibility: async () => ({
              responsibility: f.task,
              workstreamRevision: f.observation.workstreamRevision,
            }),
            readTaskAdmission: async () =>
              ++admissionReads === 1
                ? initialAdmission
                : { ...initialAdmission, resourceAdmission: "exhausted" },
          },
          ports: canonicalPorts,
          configuration: f.runtimeReadiness,
          sourceBinding: {
            authorityDigest: operatingContractHash("canonical preflight authority"),
            taskDigest: f.observation.sourceRevisionDigest,
            combined,
          },
        }),
      ).rejects.toMatchObject({ code: "supervision_readiness_changed" });
      expect(admissionReads).toBe(2);
    });
  } finally {
    await store.close();
  }
});

it.each([0, 31_000])(
  "dates canonical final checks without extending context validity (%i ms delay)",
  async (finalDelayMs) => {
    const f = await dispatchFixture(roots);
    const combined = operatingContractHash("slow final admission source");
    const plan = {
      ...(await f.ports.propose(
        projectOutcomeSupervision({
          snapshot: f.observation,
          now: f.ports.now(),
          maximumRecoveryDecisions: 1,
        }),
      ))!,
      sourceRevisionDigest: combined,
      effectContract: "work.managed_execution.v1",
    };
    const { readWorkerReadiness: _readWorkerReadiness, ...canonicalPorts } = f.ports;
    let nowMs = Date.now();
    const initialNowMs = nowMs;
    const now = () => new Date(nowMs).toISOString();
    const knowledge = await inspectSupervisionKnowledgeReadiness({
      repositoryRoot: f.root,
      projectId: plan.projectId,
      requiredPaths: plan.expectedPaths,
      now,
    });
    if (knowledge.sourceSnapshotId === null)
      throw new Error("The fixture has no knowledge snapshot.");
    const knowledgeSnapshotId = knowledge.sourceSnapshotId;
    const store = await NodeSupervisionStore.open({
      repositoryRoot: f.root,
      binding: f.binding,
      now,
    });
    try {
      await store.withOwner(async (session) => {
        let taskAdmissionReads = 0;
        let finalAdmissionReads = 0;
        let delayedFinalRead = false;
        const preflight = readNodeDispatchPreflight({
          repositoryRoot: f.root,
          plan,
          session: {
            ...session,
            readTaskResponsibility: async () => ({
              responsibility: f.task,
              workstreamRevision: f.observation.workstreamRevision,
            }),
            readTaskAdmission: async () => {
              taskAdmissionReads++;
              return f.ports.readAdmission(plan);
            },
            readResponsibility: async (assignmentId) => {
              if (!delayedFinalRead) {
                nowMs += finalDelayMs;
                delayedFinalRead = true;
              }
              return session.readResponsibility(assignmentId);
            },
          },
          ports: { ...canonicalPorts, now },
          configuration: f.runtimeReadiness,
          expectedKnowledgeSnapshotId: knowledgeSnapshotId,
          sourceBinding: {
            authorityDigest: operatingContractHash("slow final admission authority"),
            taskDigest: f.observation.sourceRevisionDigest,
            combined,
          },
          readAdmission: async () => {
            finalAdmissionReads++;
            if (finalAdmissionReads === 1) nowMs += 8000;
            return { ...(await f.ports.readAdmission(plan)), observedAt: now() };
          },
        });
        if (finalDelayMs !== 0) {
          await expect(preflight).rejects.toMatchObject({ code: "supervision_readiness_stale" });
          expect(taskAdmissionReads).toBe(2);
          expect(finalAdmissionReads).toBe(2);
          return;
        }
        const result = await preflight;
        expect(taskAdmissionReads).toBe(2);
        expect(finalAdmissionReads).toBe(2);
        expect(Date.parse(result.readiness.observation.observedAt)).toBeGreaterThanOrEqual(
          initialNowMs + 8000,
        );
        expect(
          Date.parse(now()) - Date.parse(result.readiness.observation.observedAt),
        ).toBeLessThanOrEqual(5000);
        expect(Date.parse(now()) - Date.parse(result.admission.observedAt)).toBeLessThanOrEqual(
          5000,
        );
      });
    } finally {
      await store.close();
    }
  },
);
