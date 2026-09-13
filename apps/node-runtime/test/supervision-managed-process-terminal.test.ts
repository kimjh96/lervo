import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { managedExecutionIdentity, operatingContractHash } from "@lervo/work-controller";

import { runSupervisedManagedProcess } from "../src/supervision-managed-process.js";
import type { SupervisedManagedInvocation } from "../src/supervision-managed-admission.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([
  ["requested", false],
  ["terminal_without_stop", false],
  ["stopped_terminal", true],
] as const)("requires a reconciled child run after process exit: %s", async (state, reconciled) => {
  const root = await mkdtemp(join(tmpdir(), "lervo-managed-terminal-"));
  roots.push(root);
  const cliBundle = join(root, "child.mjs");
  await writeFile(
    cliBundle,
    'process.stdin.resume(); process.stdin.on("end", () => process.exit(0));\n',
  );
  const plan = {
    projectId: `prj_${"a".repeat(16)}`,
    deadline: new Date(Date.now() + 20_000).toISOString(),
  };
  const assignmentId = `asn_${"b".repeat(24)}`;
  const invocation = {
    plan,
    effect: { responsibility: { assignmentId } },
  } as unknown as SupervisedManagedInvocation;
  const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(plan));
  const event = (seq: number, type: string, payload: Record<string, unknown>) =>
    ({
      seq,
      eventId: `evt_${String(seq).padStart(32, "0")}`,
      ...identity,
      type,
      payload,
    }) as unknown as EventEnvelope;
  const originals = [
    event(1, "managed.execution.reserved", { executionKey: operatingContractHash(plan) }),
    event(2, "work.causality.recorded", { assignmentId }),
    event(3, "run.requested", {}),
    ...(state === "requested"
      ? []
      : [
          ...(state === "stopped_terminal"
            ? [event(4, "adapter.stopped", { status: "completed" })]
            : []),
          event(state === "stopped_terminal" ? 5 : 4, "run.completed", {}),
        ]),
  ];
  const events = {
    list: ({ afterSeq = 0, limit }: { afterSeq?: number; limit: number }) =>
      originals.filter((item) => item.seq > afterSeq).slice(0, limit),
  } as unknown as EventStore;
  const result = runSupervisedManagedProcess({
    repositoryRoot: root,
    invocation,
    configuration: {
      nodeExecutable: process.execPath,
      cliBundle,
      providerExecutable: process.execPath,
      environment: { PATH: process.env.PATH ?? "" },
    },
    events,
    fence: { commit: <T>(effect: () => T) => effect(), renew: () => undefined },
    now: () => new Date().toISOString(),
    revalidate: async () => undefined,
  });
  if (reconciled)
    await expect(result).resolves.toEqual({
      eventIds: [originals[0]!.eventId, originals[2]!.eventId],
    });
  else await expect(result).rejects.toThrow("requires reconciliation");
});
