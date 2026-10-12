import { rename, rm, writeFile } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { projectManagedAttempts, projectWorkstreamResources } from "@lervo/work-controller";
import {
  causalityPayload,
  projectId,
  workstreamId,
} from "../../../packages/work-controller/test/fixtures.js";
import { SupervisionAuthorityHistory } from "../src/supervision-authority-history.js";
import { scopedHistoryFixture } from "./supervision-scoped-history.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const ownRun = "run_111111111111111111111111";
const assignmentId = "asn_111111111111111111111111";
const unrelatedRun = "run_222222222222222222222222";

it("retains complete owned execution beyond a 32 MiB unrelated corpus and matches full-history facts", async () => {
  const f = await scopedHistoryFixture(roots);
  f.append("work.causality.recorded", ownRun, causalityPayload({ assignmentId }));
  f.append("run.requested", ownRun);
  f.append("adapter.started", ownRun, {}, "codex");
  f.append("work.causality.recorded", unrelatedRun, {
    ...causalityPayload({
      assignmentId: "asn_222222222222222222222222",
      workId: "wrk_222222222222222222222222",
    }),
    workstreamId: "wks_222222222222222222222222",
  });
  const child = "run_333333333333333333333333";
  f.append("work.causality.recorded", child, {
    ...causalityPayload({ assignmentId, relationship: "subagent", parentRunId: ownRun }),
    workstreamId: null,
  });
  f.append("adapter.started", child, {}, "claude");
  for (const [runId, provider, scope, suffix] of [
    [ownRun, "codex", "primary_provider", "1"],
    [child, "claude", "subagent_provider", "3"],
  ] as const)
    f.append(
      "resource.usage.recorded",
      runId,
      {
        workId: `wrk_${"1".repeat(24)}`,
        resourceObservationId: `ruo_${suffix.repeat(24)}`,
        sourceCoordinateDigest: `sha256:${suffix.repeat(64)}`,
        scope,
        source: "provider_reported",
        accountingMode: "turn_cumulative",
        accountingDescriptorHash: `sha256:${suffix.repeat(64)}`,
        modelIdentity: {
          provider,
          requestedModel: null,
          answerModel: "fixture",
          observedModelIds: ["fixture"],
          answerModelEvidence: "thread_start",
          unavailableReason: null,
        },
        status: "observed",
        usage: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 4,
          reasoningOutputTokens: 1,
          totalTokens: 14,
          contextWindow: 200000,
        },
        reasonCode: null,
      },
      provider,
    );
  for (let index = 0; index < 45_000; index += 1)
    f.append("context.selected", unrelatedRun, {
      documentId: `sha256:${"a".repeat(64)}`,
      reasonCode: "required_repository_contract",
      required: true,
      scope: "task",
      knowledgeContext: {
        sourceSnapshotId: "ksnap_fixture",
        policyHash: `sha256:${"b".repeat(64)}`,
        proofHash: `sha256:${"c".repeat(64)}`,
      },
    });
  f.append("context.injected", child, { receiptId: "fixture_child_receipt" });
  f.append("run.completed", ownRun, { verificationStatus: "passed" });
  const complete = new SupervisionAuthorityHistory(
    f.events,
    f.databasePath,
    projectId,
    Date.now,
    "execution",
  );
  await expect(complete.read()).rejects.toThrow("projection exceeds its byte bound");
  const selected = await f.reader.read();
  expect(selected.filter((row) => row.runId === child)).toEqual(
    f.rows.filter((row) => row.runId === child),
  );
  expect(
    selected.some((row) => row.type === "context.selected" && row.runId === unrelatedRun),
  ).toBe(false);
  expect(projectManagedAttempts({ events: selected, workstreamId })).toEqual(
    projectManagedAttempts({ events: f.rows, workstreamId }),
  );
  expect(projectWorkstreamResources({ events: selected, workstreamId })).toEqual(
    projectWorkstreamResources({ events: f.rows, workstreamId }),
  );
  expect(
    projectWorkstreamResources({ events: selected, workstreamId }).groups.reduce(
      (total, group) => total + (group.totalTokens ?? 0),
      0,
    ),
  ).toBe(28);
  expect(f.rows).toHaveLength(45_010);
}, 30000);

it("backfills events preceding a new causal binding and reuses the unchanged verified projection", async () => {
  const f = await scopedHistoryFixture(roots);
  const body = f.append("adapter.started", ownRun, { provider: "codex" });
  expect(await f.reader.read()).toEqual([]);
  f.append("work.causality.recorded", ownRun, causalityPayload({ assignmentId }));
  expect(await f.reader.read()).toEqual(f.rows);
  expect((await f.reader.read())[0]).toEqual(body);
  const list = vi.spyOn(f.events, "list");
  const result = await f.reader.read();
  result[0]!.payload.externalMutation = true;
  expect(await f.reader.read()).toEqual(f.rows);
  expect(list).not.toHaveBeenCalled();
});

it("backfills a causal binding appended between metadata and execution observation", async () => {
  const f = await scopedHistoryFixture(roots);
  f.append("adapter.started", ownRun);
  const list = f.events.list.bind(f.events);
  let calls = 0;
  vi.spyOn(f.events, "list").mockImplementation((options) => {
    const rows = list(options);
    if (++calls === 2)
      f.append("work.causality.recorded", ownRun, causalityPayload({ assignmentId }));
    return rows;
  });
  expect(await f.reader.read()).toEqual(f.rows);
  expect(calls).toBeGreaterThan(2);
});

it.each([60_000, -1])(
  "rejects corruption in unselected history on audit or clock rollback (%s)",
  async (advance) => {
    const f = await scopedHistoryFixture(roots);
    f.append("context.selected", unrelatedRun, { documentId: "fixture" });
    await f.reader.read();
    f.rows[0]!.payload.documentId = "changed";
    f.advance(advance);
    // The audit rereads history from the first event, where the store rejects the changed row.
    await expect(f.reader.read()).rejects.toThrow("hash does not match");
  },
);

it("retains explicitly linked historical runs and detects database replacement", async () => {
  const f = await scopedHistoryFixture(roots);
  f.append("adapter.started", ownRun);
  f.append("work.supervision.dispatch.observed", "run_control", {
    workstreamId,
    managedRunId: ownRun,
  });
  expect(await f.reader.read()).toEqual(f.rows);
  await rename(f.databasePath, `${f.databasePath}.before`);
  await writeFile(f.databasePath, "replacement");
  await expect(f.reader.read()).rejects.toThrow("database was replaced");
});

it("fails closed on malformed unrelated causality and preserves the complete sequence bound", async () => {
  const f = await scopedHistoryFixture(roots);
  f.append("work.causality.recorded", unrelatedRun, {
    ...causalityPayload({ assignmentId }),
    workstreamId: null,
    relationship: "retry",
    parentRunId: "run_999999999999999999999999",
    retryOfRunId: "run_999999999999999999999999",
    attemptOrdinal: 2,
  });
  await expect(f.reader.read()).rejects.toMatchObject({ code: "causality_parent_missing" });
  vi.spyOn(f.events, "latest").mockReturnValue({ ...f.rows[0]!, seq: 100_001 });
  const list = vi.spyOn(f.events, "list");
  await expect(f.reader.read()).rejects.toThrow("source bound");
  expect(list).not.toHaveBeenCalled();
});
