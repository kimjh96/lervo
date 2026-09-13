import type { SupervisedManagedInvocation } from "@lervo/node-runtime";
import {
  operatingContractHash,
  supervisedManagedExecutionFields,
  supervisedManagedRetryCausality,
} from "@lervo/work-controller";
import type { CliIo, CliServices } from "./types.js";

export async function runSupervisedManagedCommand(
  root: string,
  io: CliIo,
  services: CliServices,
): Promise<number> {
  try {
    if (io.stdin === undefined) throw new Error("Standard input is required.");
    const text = await io.stdin(256 * 1024);
    if (Buffer.byteLength(text) > 256 * 1024) throw new Error("The invocation exceeds its limit.");
    const payload = JSON.parse(text) as {
      invocation: SupervisedManagedInvocation;
      providerExecutable: string;
    };
    if (Object.keys(payload).sort().join(",") !== "invocation,providerExecutable")
      throw new Error("The invocation envelope is invalid.");
    const invocation = payload.invocation;
    supervisedManagedExecutionFields(invocation.effect);
    const effect = invocation.effect;
    const task = effect.responsibility;
    const outcome = await services.executeManagedRun({
      repositoryRoot: root,
      provider: effect.provider,
      providerExecutable: payload.providerExecutable,
      expectedPaths: task.expectedPaths,
      instructions: effect.instructions,
      risk: effect.risk,
      roleId: task.roleId,
      verificationSuiteIds: task.verificationSuiteIds,
      executionKey: operatingContractHash(invocation.plan),
      supervisedInvocation: invocation,
      assignmentFinalization: "governed",
      ...(effect.schemaVersion === 2
        ? { workCausality: supervisedManagedRetryCausality(effect, invocation.plan.workstreamId)! }
        : {}),
      workforce: {
        assignmentId: task.assignmentId,
        agentId: task.executorAgentId,
        leaseId: effect.leaseId,
      },
    });
    io.stdout(`${JSON.stringify(outcome)}\n`);
    return outcome.verificationStatus === "passed" &&
      outcome.writingPublication.status === "allowed"
      ? 0
      : 1;
  } catch {
    io.stderr('{"code":"supervised_execution_failed"}\n');
    return 1;
  }
}
