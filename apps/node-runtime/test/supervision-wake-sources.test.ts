import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { workforceSourcePaths } from "@lervo/agent-workforce";
import { afterEach, expect, it, vi } from "vitest";

import { fixture } from "../../../packages/repository-knowledge-runtime/test/fixture.js";
import {
  supervisionDutyDeadlines,
  watchSupervisionSources,
} from "../src/supervision-wake-schedule.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function checkout() {
  const f = await fixture(true);
  cleanups.push(async () => {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return f.root;
}

/** File watches are detectors, so the stimulus is rewritten until it is seen. */
async function seen(hint: ReturnType<typeof vi.fn>, write: () => Promise<void>) {
  hint.mockClear();
  await vi.waitFor(
    async () => {
      await write();
      expect(hint).toHaveBeenCalled();
    },
    { timeout: 15_000, interval: 250 },
  );
}

it(
  "wakes supervision for the current workstream, its branch bindings and workforce sources (ADR-0602)",
  { timeout: 60_000 },
  async () => {
    const root = await checkout();
    const hint = vi.fn();
    const stop = watchSupervisionSources(root, hint);
    cleanups.push(async () => stop());
    // The workforce watch arms once its paths resolve, and says so with one hint.
    await vi.waitFor(() => expect(hint).toHaveBeenCalled(), { timeout: 10_000 });
    const workstreams = resolve(root, ".lervo/state/workstreams");
    await mkdir(workstreams, { recursive: true });
    await seen(hint, () => writeFile(resolve(workstreams, "current.json"), `${Date.now()}\n`));
    await seen(hint, () => writeFile(resolve(workstreams, "bindings.json"), `${Date.now()}\n`));
    const paths = await workforceSourcePaths(root);
    const assignments = paths.trees[0]!;
    await mkdir(resolve(assignments, "nested"), { recursive: true });
    await seen(hint, () =>
      writeFile(resolve(assignments, "nested", "assignment.json"), `${Date.now()}\n`),
    );
    await mkdir(resolve(paths.files[1]!, ".."), { recursive: true });
    await seen(hint, () => writeFile(paths.files[1]!, `${Date.now()}\n`));
  },
);

it("reports every duty deadline as it is, a lapsed one too (ADR-0602)", () => {
  const lapsed = Date.now() - 5_000;
  expect(
    supervisionDutyDeadlines({
      mandateExpiresAt: () => lapsed - 1,
      nextCheckAt: () => lapsed,
      peers: { nextAuditAt: () => null },
      delivery: { nextRetryAt: () => lapsed + 1 },
    }),
  ).toEqual([lapsed - 1, lapsed, null, lapsed + 1]);
});
