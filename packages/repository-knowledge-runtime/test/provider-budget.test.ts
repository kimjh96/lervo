import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import type { OutboxStore } from "@lervo/storage-contract";
import { sha256 } from "@lervo/repository-knowledge";
import { reserveConvergenceProviderCall } from "../src/provider-budget.js";

it("retains spent reservations across reopen and never prunes an unresolved batch", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-budget-"));
  const input = {
    repositoryRoot: root,
    obligationId: `kconv_${"a".repeat(24)}`,
    batchId: "exact-first-batch",
    maximumCalls: 2,
    events: { get: () => null } as unknown as OutboxStore,
  };
  try {
    expect(await reserveConvergenceProviderCall(input)).toBe(1);
    expect(await reserveConvergenceProviderCall(input)).toBe(2);
    await expect(reserveConvergenceProviderCall(input)).rejects.toMatchObject({
      code: "normalization_budget_exceeded",
    });
    const db = new DatabaseSync(
      resolve(root, ".lervo/state/knowledge/convergence-budgets.sqlite"),
      { readOnly: true },
    );
    try {
      expect(db.prepare("SELECT calls,obligation_id FROM budgets").all()).toEqual([
        { calls: 2, obligation_id: input.obligationId },
      ]);
    } finally {
      db.close();
    }
    expect(await reserveConvergenceProviderCall({ ...input, batchId: "exact-second-batch" })).toBe(
      1,
    );
    await expect(reserveConvergenceProviderCall(input)).rejects.toMatchObject({
      code: "normalization_budget_exceeded",
    });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("gives a batch that earlier logic exhausted one fresh budget under new logic", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-budget-"));
  const input = {
    repositoryRoot: root,
    obligationId: `kconv_${"b".repeat(24)}`,
    batchId: "exhausted-batch",
    maximumCalls: 3,
    events: { get: () => null } as unknown as OutboxStore,
  };
  try {
    // Prepare the store, then record the batch as exhausted under a key without the current logic.
    expect(await reserveConvergenceProviderCall({ ...input, batchId: "other-batch" })).toBe(1);
    const db = new DatabaseSync(resolve(root, ".lervo/state/knowledge/convergence-budgets.sqlite"));
    try {
      db.prepare("INSERT INTO budgets(batch_hash,calls,obligation_id) VALUES(?,?,?)").run(
        sha256(input.batchId),
        3,
        input.obligationId,
      );
    } finally {
      db.close();
    }
    expect(await reserveConvergenceProviderCall(input)).toBe(1);
    expect(await reserveConvergenceProviderCall(input)).toBe(2);
    expect(await reserveConvergenceProviderCall(input)).toBe(3);
    await expect(reserveConvergenceProviderCall(input)).rejects.toMatchObject({
      code: "normalization_budget_exceeded",
    });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
