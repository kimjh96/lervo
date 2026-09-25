import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  authorityRenewalTick,
  runSupervisedManagedProcess,
  SupervisedManagedProcessError,
} from "../src/supervision-managed-process.js";

const roots: string[] = [];
const stores: SQLiteEventStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(script: string, deadlineMs = 60_000) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-managed-abort-"));
  roots.push(root);
  const cliBundle = resolve(root, "fake-cli.mjs");
  await writeFile(cliBundle, script);
  const projectId = `prj_${"a".repeat(16)}`;
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId,
    writableEventSchemaVersion: 3,
  });
  stores.push(events);
  const now = () => new Date().toISOString();
  const invocation = {
    plan: {
      projectId,
      deadline: new Date(Date.now() + deadlineMs).toISOString(),
      effectHash: `sha256:${"b".repeat(64)}`,
    },
    effect: { responsibility: { assignmentId: `asn_${"c".repeat(24)}` } },
  } as unknown as Parameters<typeof runSupervisedManagedProcess>[0]["invocation"];
  return {
    run: (revalidate: () => Promise<void> = async () => undefined, signal?: AbortSignal) =>
      runSupervisedManagedProcess({
        repositoryRoot: root,
        invocation,
        configuration: {
          nodeExecutable: process.execPath,
          cliBundle,
          providerExecutable: process.execPath,
          environment: { PATH: process.env.PATH ?? "" },
        },
        events,
        fence: { commit: (effect) => effect(), renew: () => undefined },
        now,
        revalidate,
        ...(signal === undefined ? {} : { signal }),
      }),
  };
}

it("reports an output bound abort with a bounded code and no child output", async () => {
  const f = await fixture(
    `process.stdin.resume(); const chunk = "x".repeat(65536); let n = 0;
     const tick = () => { if (n++ < 40) { process.stdout.write(chunk); setTimeout(tick, 5); } else setTimeout(tick, 1000); };
     tick();`,
  );
  const error = await f.run().catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(SupervisedManagedProcessError);
  expect((error as SupervisedManagedProcessError).code).toBe("managed_output_bound_exceeded");
  expect((error as Error).message).not.toContain("xxxx");
});

it("reports cancellation and a missing dispatch record distinctly", async () => {
  const cancelled = await fixture(`process.stdin.resume(); setInterval(() => {}, 1000);`);
  const controller = new AbortController();
  const pending = cancelled.run(async () => undefined, controller.signal);
  setTimeout(() => controller.abort(), 200);
  await expect(pending).rejects.toMatchObject({ code: "managed_cancelled" });
  const silent = await fixture(
    `process.stdin.resume(); process.stdin.on("end", () => process.exit(0));`,
  );
  await expect(silent.run()).rejects.toMatchObject({ code: "managed_dispatch_evidence_missing" });
});

it("keeps a worker through slow authority reads until four unconfirmed minutes, and aborts on rejection", async () => {
  const sleep = (ms: number) => new Promise<void>((settle) => setTimeout(settle, ms));
  let clock = 0;
  const reasons: unknown[] = [];
  const record = (revalidate: () => Promise<void>) => {
    const outcome = { renewed: 0, aborted: 0 };
    const tick = authorityRenewalTick({
      revalidate,
      renew: () => outcome.renewed++,
      abort: (reason) => {
        reasons.push(reason);
        outcome.aborted++;
      },
      windowMs: 20,
      maximumUnconfirmedMs: 240_000,
      now: () => clock,
    });
    return { tick, outcome };
  };

  const hung = record(() => new Promise<void>(() => undefined));
  for (const minute of [1, 2, 3]) {
    clock = minute * 60_000;
    await hung.tick();
  }
  expect(hung.outcome).toEqual({ renewed: 0, aborted: 0 });
  clock = 4 * 60_000;
  await hung.tick();
  expect(hung.outcome.aborted).toBe(1);

  clock = 0;
  const lateSuccess = record(() => sleep(60));
  clock = 60_000;
  await lateSuccess.tick();
  await sleep(80);
  expect(lateSuccess.outcome).toEqual({ renewed: 1, aborted: 0 });
  clock = 290_000;
  await lateSuccess.tick();
  expect(lateSuccess.outcome.aborted).toBe(0);

  const revoked = record(async () => {
    throw new Error("revoked");
  });
  await revoked.tick();
  expect(revoked.outcome).toEqual({ renewed: 0, aborted: 1 });
  expect(reasons.at(-1)).toMatchObject({ message: "revoked" });

  const late = record(async () => {
    await sleep(60);
    throw new Error("revoked after the window");
  });
  await late.tick();
  expect(late.outcome.aborted).toBe(0);
  await sleep(80);
  expect(late.outcome.aborted).toBe(1);
});
