import {
  admitSupervisedManagedInvocation,
  type SupervisedManagedInvocation,
} from "@lervo/node-runtime";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, supervisedManagedRetryCausality } from "@lervo/work-controller";
import type { ManagedRunRequest } from "./managed-run.js";
import { resolveManagedRunExpectedPaths } from "./managed-run-request.js";
import type { ProviderAdapter } from "@lervo/adapter-contract";

export async function admitSupervisedManagedRun<T>(input: {
  storage: ProjectStorage;
  request: ManagedRunRequest;
  invocation: SupervisedManagedInvocation;
  now(): string;
  executionRepositoryRoot?: string;
  commit(): T;
}): Promise<T> {
  const { request, invocation } = input;
  const effect = invocation.effect;
  const task = effect.responsibility;
  const actual = {
    provider: request.provider,
    instructions: request.instructions,
    risk: request.risk,
    expectedPaths: resolveManagedRunExpectedPaths(request),
    roleId: request.roleId ?? "developer",
    verificationSuiteIds: [...request.verificationSuiteIds],
    workforce: request.workforce,
  };
  const expected = {
    provider: effect.provider,
    instructions: effect.instructions,
    risk: effect.risk,
    expectedPaths: task.expectedPaths,
    roleId: task.roleId,
    verificationSuiteIds: task.verificationSuiteIds,
    workforce: {
      assignmentId: task.assignmentId,
      agentId: task.executorAgentId,
      leaseId: effect.leaseId,
    },
  };
  if (
    operatingContractHash(actual) !== operatingContractHash(expected) ||
    request.executionKey !== operatingContractHash(invocation.plan) ||
    request.assignmentFinalization !== "governed" ||
    (request.skillIds?.length ?? 0) > 0 ||
    (request.capabilityIds?.length ?? 0) > 0 ||
    operatingContractHash(request.workCausality ?? null) !==
      operatingContractHash(
        supervisedManagedRetryCausality(effect, invocation.plan.workstreamId) ?? null,
      )
  )
    throw new Error("The managed request differs from the supervised invocation.");
  return admitSupervisedManagedInvocation({
    storage: input.storage,
    invocation,
    now: input.now,
    ...(input.executionRepositoryRoot === undefined
      ? {}
      : { executionRepositoryRoot: input.executionRepositoryRoot }),
    commit: input.commit,
  });
}

export function guardSupervisedProviderStart(
  adapter: ProviderAdapter,
  verify: () => Promise<void>,
): ProviderAdapter {
  return {
    descriptor: adapter.descriptor,
    resourceAccounting: adapter.resourceAccounting,
    start: async (request) => {
      await verify();
      return adapter.start(request);
    },
    inspectProcess: (session) => adapter.inspectProcess(session),
    injectContext: (session, envelope) => adapter.injectContext(session, envelope),
    ...(adapter.confirmCapabilityActivation === undefined
      ? {}
      : {
          confirmCapabilityActivation: (session: Parameters<ProviderAdapter["startTurn"]>[0]) =>
            adapter.confirmCapabilityActivation!(session),
        }),
    attachManagedWriteBridge: (session, bridge) =>
      adapter.attachManagedWriteBridge(session, {
        authorize: async (request) => {
          await verify();
          return bridge.authorize(request);
        },
        complete: (completion) => bridge.complete(completion),
      }),
    startTurn: async (session, request, accepted) => {
      await verify();
      return adapter.startTurn(session, request, accepted);
    },
    events: (session, signal) => adapter.events(session, signal),
    getTurnResult: (session, turn) => adapter.getTurnResult(session, turn),
    stop: (session, request) => adapter.stop(session, request),
  };
}
