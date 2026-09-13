import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { operatingContractHash, projectOutcomeSupervision } from "@lervo/work-controller";
import { NodeSupervisionStore } from "../src/supervision-store.js";
import { readNodeDispatchPreflight } from "../src/supervision-dispatch-readiness.js";
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
