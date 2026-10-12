import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { observeContextPreparation } from "@lervo/context";
import { afterEach, expect, it } from "vitest";

import { readTerminalActivationReceipts } from "../src/terminal-activation-state.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("reads historical receipts and discards unsupported diagnostics without fabricating observations", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-preparation-reader-"));
  roots.push(root);
  const directory = resolve(root, ".lervo/state/terminal-integration");
  await mkdir(directory, { recursive: true });
  const base = {
    schemaVersion: 1,
    contractId: "lervo_terminal_hooks_v2",
    provider: "codex",
    hookEvent: "UserPromptSubmit",
    result: "context_prepared",
    occurredAt: "2026-10-09T00:00:00Z",
  };
  const path = resolve(directory, "codex-user-prompt-submit.json");
  const report = observeContextPreparation({
    requestDigest: `sha256:${"a".repeat(64)}`,
    sourceSnapshotId: null,
    retrieval: "not_run",
    candidateCount: null,
    selected: [],
    loads: [],
  });
  for (const receipt of [
    base,
    { ...base, preparationQuality: report },
    { ...base, preparationQuality: { ...report, schemaVersion: 2 } },
  ]) {
    await writeFile(path, JSON.stringify(receipt));
    const [read] = await readTerminalActivationReceipts(root);
    expect(read).toMatchObject(base);
    expect(read?.preparationQuality).toEqual(
      "preparationQuality" in receipt && receipt.preparationQuality.schemaVersion === 1
        ? report
        : undefined,
    );
  }
});
