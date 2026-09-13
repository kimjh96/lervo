import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import type { EventStore } from "@lervo/storage-contract";
import { afterEach, expect, it, vi } from "vitest";
import {
  plan,
  responsibility,
} from "../../../packages/work-controller/test/operating-supervision.fixture.js";
import { runSupervisedManagedProcess } from "../src/supervision-managed-process.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

function start(revalidate: () => Promise<void>) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T03:00:00.000Z"));
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(() => true),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const selectedPlan = plan();
  const renew = vi.fn();
  const controller = new AbortController();
  const result = runSupervisedManagedProcess({
    repositoryRoot: resolve("."),
    invocation: {
      plan: selectedPlan,
      effect: {
        schemaVersion: 1,
        kind: "work.managed_execution",
        responsibility: responsibility(),
        leaseId: "lse_fixture",
        provider: "codex",
        instructions: "Inspect the assigned source.",
        risk: "low",
        reservedTokens: 100,
      },
      authorityDigest: selectedPlan.sourceRevisionDigest,
      ownerLease: {
        supervisionId: selectedPlan.supervisionId,
        ownerAgentId: selectedPlan.ownerAgentId,
        token: "fixture-owner-token",
        generation: 1,
        expiresAtMs: Date.now() + 300_000,
      },
    },
    configuration: {
      nodeExecutable: process.execPath,
      cliBundle: resolve("fixture-cli.js"),
      providerExecutable: process.execPath,
      environment: {},
    },
    events: {} as EventStore,
    fence: { commit: (effect) => effect(), renew },
    now: () => new Date().toISOString(),
    revalidate,
    signal: controller.signal,
  }).then(
    () => "confirmed",
    (error: Error) => error.message,
  );
  return { child, renew, controller, result };
}

it("interrupts the worker when authority observation hangs and ignores a late success", async () => {
  let complete!: () => void;
  const revalidate = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  const f = start(revalidate);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(revalidate).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(f.child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
  complete();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(f.renew).not.toHaveBeenCalled();
  expect(f.child.kill).toHaveBeenLastCalledWith("SIGKILL");
  f.child.emit("close", null, "SIGKILL");
  expect(await f.result).toMatch(/requires reconciliation/u);
});

it("finishes cancellation after child close even if revalidation never settles", async () => {
  const f = start(() => new Promise<void>(() => undefined));
  let outcome: string | undefined;
  void f.result.then((value) => {
    outcome = value;
  });
  await vi.advanceTimersByTimeAsync(60_000);
  f.controller.abort();
  f.child.emit("close", null, "SIGTERM");
  await vi.advanceTimersByTimeAsync(5_000);
  expect(outcome).toMatch(/requires reconciliation/u);
  expect(f.renew).not.toHaveBeenCalled();
});

it("renews once after a timely observation and does not retain its deadline", async () => {
  const f = start(async () => undefined);
  await vi.advanceTimersByTimeAsync(65_000);
  expect(f.renew).toHaveBeenCalledTimes(1);
  expect(f.child.kill).not.toHaveBeenCalled();
  f.controller.abort();
  f.child.emit("close", null, "SIGTERM");
  expect(await f.result).toMatch(/requires reconciliation/u);
});

it("does not renew after cancellation while the child is still shutting down", async () => {
  let complete!: () => void;
  const f = start(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  f.controller.abort();
  complete();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(f.renew).not.toHaveBeenCalled();
  expect(f.child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
  f.child.emit("close", null, "SIGTERM");
  expect(await f.result).toMatch(/requires reconciliation/u);
});
