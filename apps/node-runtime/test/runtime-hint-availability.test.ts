import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { readRepositoryWatchIssues } from "@lervo/repository-knowledge-runtime";
import { expect, it, vi } from "vitest";

import { runtimeHintAvailability } from "../src/runtime-hint-availability.js";

it("reports an outdated Hub with its own remedy, apart from a failing wait (ADR-0602)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-hints-"));
  try {
    const report = runtimeHintAvailability(root)!;
    const codes = async () => (await readRepositoryWatchIssues(root)).map((issue) => issue.code);
    report(
      Object.assign(new Error("The Hub is older than this release."), {
        code: "hub_upgrade_required",
      }),
    );
    await vi.waitFor(async () => expect(await codes()).toEqual(["hub_upgrade_required"]));
    report(new Error("connection reset"));
    await vi.waitFor(async () =>
      expect((await codes()).sort()).toEqual([
        "hub_runtime_changes_unavailable",
        "hub_upgrade_required",
      ]),
    );
    report(null);
    await vi.waitFor(async () => expect(await codes()).toEqual([]));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
