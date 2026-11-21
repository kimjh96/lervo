import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NodeFleetApplyError } from "../src/node-fleet-apply-contract.js";
import {
  blockersWithoutBaselineEvidence,
  witnessRestoredPredecessor,
} from "../src/node-fleet-readiness-witness.js";
import { applyRegisteredNodeUpgrade } from "../src/upgrade-node-apply.js";
import type { NodeUpgradeInspection } from "../src/upgrade-node.js";
import {
  clearUpgradeNodeFailure,
  recordUpgradeNodeFailure,
  UPGRADE_NODE_FAILURE_PATH,
} from "../src/upgrade-node-failure-record.js";

const fixture = vi.hoisted(() => ({
  apply: vi.fn(),
  health: [] as NodeRuntimeHealthSnapshot[],
}));
vi.mock("../src/node-fleet-apply.js", () => ({
  applyNodeFleetOnboarding: (...args: unknown[]) => fixture.apply(...args),
}));
vi.mock("../src/node-fleet-health.js", () => ({
  readNodeFleetHealthSnapshot: async () =>
    fixture.health.length > 1 ? fixture.health.shift() : fixture.health[0],
}));

const roots: string[] = [];
afterEach(async () => {
  fixture.apply.mockReset();
  fixture.health = [];
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const attention = {
  status: "unavailable" as const,
  failureCode: "supervision_attention_required",
  reasonCodes: ["owner_plan_unavailable"],
};

function snapshot(
  processId: number,
  supervision: NodeRuntimeHealthSnapshot["supervision"],
  at = Date.now() + 1_000,
): NodeRuntimeHealthSnapshot {
  return {
    schemaVersion: 1,
    status: supervision?.status === "pending" ? "starting" : "degraded",
    processId,
    startedAt: new Date(at - 60_000).toISOString(),
    updatedAt: new Date(at).toISOString(),
    sync: { status: "ready" },
    workstreamReplication: { status: "ready" },
    workspaceCoordination: { status: "disabled" },
    remoteControl: { status: "ready" },
    supervision,
  } as NodeRuntimeHealthSnapshot;
}

/** The replacement settled supervision where the predecessor had never evaluated it. */
const firstEvaluation = (blocker: { observed: string; baseline: string | null }) =>
  new NodeFleetApplyError("node_fleet_readiness_timeout", "not ready", {
    details: {
      readiness: {
        baseline: "observed",
        blockers: [{ component: "supervision", ...blocker }],
        lastStatus: "degraded",
        lastProcessId: 900,
        observations: 280,
      },
      recovery: "restored",
    },
  });
const evaluated = "unavailable:supervision_attention_required";

describe("a baseline without evidence (ADR-0475)", () => {
  it("is judged only for settled non-delivery blockers whose predecessor gave no evidence", () => {
    expect(
      blockersWithoutBaselineEvidence(
        firstEvaluation({ observed: evaluated, baseline: "pending" }),
      ),
    ).toHaveLength(1);
    expect(
      blockersWithoutBaselineEvidence(firstEvaluation({ observed: evaluated, baseline: null })),
    ).toHaveLength(1);
    // A predecessor that was ready proves a regression; one still pending proves nothing settled.
    for (const blocker of [
      { observed: evaluated, baseline: "ready" },
      { observed: "pending", baseline: "pending" },
    ])
      expect(blockersWithoutBaselineEvidence(firstEvaluation(blocker))).toBeNull();
    const delivery = firstEvaluation({ observed: "unavailable:hub_unavailable", baseline: null });
    delivery.details.readiness!.blockers[0]!.component = "sync";
    expect(blockersWithoutBaselineEvidence(delivery)).toBeNull();
    const unrestored = firstEvaluation({ observed: evaluated, baseline: "pending" });
    unrestored.details.recovery = "failed";
    expect(blockersWithoutBaselineEvidence(unrestored)).toBeNull();
    expect(blockersWithoutBaselineEvidence(new Error("other"))).toBeNull();
  });

  it("waits for the restored predecessor to settle, ignoring the failed replacement", async () => {
    const notBefore = new Date();
    const states = await witnessRestoredPredecessor({
      path: "/fixture/health.json",
      notBefore,
      replacementProcessId: 900,
      components: ["supervision"],
      ports: {
        wait: async () => undefined,
        readHealth: (() => {
          const reads = [
            snapshot(900, attention),
            snapshot(100, { status: "pending" }, notBefore.getTime() + 1_000),
            snapshot(100, { status: "pending" }, notBefore.getTime() + 6_000),
            ...Array.from({ length: 3 }, () =>
              snapshot(100, attention, notBefore.getTime() + 9_000),
            ),
          ];
          return async () => (reads.length > 1 ? reads.shift()! : reads[0]!);
        })(),
      },
    });
    expect(states).toEqual({ supervision: evaluated });
    const witness = (reads: NodeRuntimeHealthSnapshot[]) =>
      witnessRestoredPredecessor({
        path: "/fixture/health.json",
        notBefore,
        replacementProcessId: 900,
        components: ["supervision"],
        ports: {
          wait: async () => undefined,
          readHealth: async () => (reads.length > 1 ? reads.shift()! : reads[0]!),
        },
      });
    // The failed replacement's last bytes are never the predecessor's evidence.
    await expect(
      witness([
        ...Array.from({ length: 3 }, () => snapshot(900, attention)),
        snapshot(100, { status: "ready" }, notBefore.getTime() + 2_000),
      ]),
    ).resolves.toEqual({ supervision: "ready" });
    // One observation is no settlement: the same state must hold three times in a row.
    await expect(
      witness([
        snapshot(100, attention, notBefore.getTime() + 1_000),
        snapshot(100, { status: "ready" }, notBefore.getTime() + 2_000),
      ]),
    ).resolves.toEqual({ supervision: "ready" });
    // States read while the predecessor is still starting are not its settlement.
    const starting = (at: number) => ({
      ...snapshot(100, attention, at),
      startedAt: new Date(notBefore.getTime()).toISOString(),
      status: "starting" as const,
    });
    await expect(
      witness([
        starting(notBefore.getTime() + 1_000),
        starting(notBefore.getTime() + 2_000),
        starting(notBefore.getTime() + 3_000),
        {
          ...snapshot(100, { status: "ready" }, notBefore.getTime() + 4_000),
          startedAt: new Date(notBefore.getTime()).toISOString(),
        },
      ]),
    ).resolves.toEqual({ supervision: "ready" });
    // A predecessor that never settles gives no evidence within the bounded window.
    await expect(
      witnessRestoredPredecessor({
        path: "/fixture/health.json",
        notBefore,
        replacementProcessId: 900,
        components: ["supervision"],
        ports: {
          wait: async () => undefined,
          readHealth: async () => snapshot(100, { status: "pending" }, notBefore.getTime() + 1),
        },
      }),
    ).resolves.toBeNull();
  });
});

describe("the Node upgrade with a predecessor witness", () => {
  let root = "";
  async function inspection(): Promise<NodeUpgradeInspection> {
    root = await mkdtemp(resolve(tmpdir(), "lervo-witness-"));
    roots.push(root);
    const configPath = resolve(root, "config.json");
    return {
      plan: {
        desired: {
          healthPath: resolve(root, "health.json"),
          repositoryRoot: root,
          runtimeVersion: "0.30.2",
        },
      },
      configPath,
      stage: {
        configPathDigest: `sha256:${createHash("sha256").update(configPath).digest("hex")}`,
      },
      replaceDeployment: true,
    } as unknown as NodeUpgradeInspection;
  }
  const receipt = { readiness: { status: "ready", carriedConditions: [] } };

  it("replaces again when the restored predecessor settles exactly as the replacement did", async () => {
    fixture.apply
      .mockRejectedValueOnce(firstEvaluation({ observed: evaluated, baseline: "pending" }))
      .mockResolvedValueOnce(receipt);
    fixture.health = Array.from({ length: 3 }, () => snapshot(100, attention));
    const upgrade = await inspection();
    // An earlier failure's record is removed by this success.
    await recordUpgradeNodeFailure(root, "0.30.1", new Error("earlier"));
    await expect(readFile(resolve(root, UPGRADE_NODE_FAILURE_PATH), "utf8")).resolves.toContain(
      "0.30.1",
    );
    await expect(applyRegisteredNodeUpgrade(upgrade)).resolves.toMatchObject({
      readiness: { witnessedConditions: [{ component: "supervision", state: evaluated }] },
    });
    expect(fixture.apply).toHaveBeenCalledTimes(2);
    // A successful stage leaves no failure record.
    await expect(readFile(resolve(root, UPGRADE_NODE_FAILURE_PATH))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("keeps the failure when the predecessor settles differently: that is a regression", async () => {
    const failure = firstEvaluation({ observed: evaluated, baseline: "pending" });
    fixture.apply.mockRejectedValueOnce(failure).mockResolvedValueOnce(receipt);
    fixture.health = Array.from({ length: 3 }, () => snapshot(100, { status: "ready" }));
    await expect(applyRegisteredNodeUpgrade(await inspection())).rejects.toBe(failure);
    expect(fixture.apply).toHaveBeenCalledOnce();
    // The CLI that failed records why in the repository, whatever CLI the follower runs.
    expect(
      JSON.parse(await readFile(resolve(root, UPGRADE_NODE_FAILURE_PATH), "utf8")),
    ).toMatchObject({
      cliVersion: "0.30.2",
      code: "node_fleet_readiness_timeout",
      failure: { readiness: { blockers: [{ component: "supervision", baseline: "pending" }] } },
    });
  });

  it("never witnesses a real regression from an evaluated baseline", async () => {
    const failure = firstEvaluation({ observed: evaluated, baseline: "ready" });
    fixture.apply.mockRejectedValueOnce(failure);
    await expect(applyRegisteredNodeUpgrade(await inspection())).rejects.toBe(failure);
    expect(fixture.apply).toHaveBeenCalledOnce();
  });
});

describe("the repository's own Node failure record (ADR-0575)", () => {
  it("records the bounded detail of the failed stage and clears it on success", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-node-failure-"));
    roots.push(root);
    await recordUpgradeNodeFailure(
      root,
      "0.30.2",
      firstEvaluation({ observed: evaluated, baseline: "pending" }),
      new Date("2026-11-21T20:41:47.000Z"),
    );
    const record = JSON.parse(await readFile(resolve(root, UPGRADE_NODE_FAILURE_PATH), "utf8"));
    expect(record).toEqual({
      schemaVersion: 1,
      failedAt: "2026-11-21T20:41:47.000Z",
      cliVersion: "0.30.2",
      code: "node_fleet_readiness_timeout",
      failure: {
        readiness: {
          baseline: "observed",
          lastStatus: "degraded",
          lastProcessId: 900,
          observations: 280,
          blockers: [{ component: "supervision", observed: evaluated, baseline: "pending" }],
        },
        recovery: "restored",
      },
    });
    expect(JSON.stringify(record)).not.toContain("not ready");
    await clearUpgradeNodeFailure(root);
    await expect(readFile(resolve(root, UPGRADE_NODE_FAILURE_PATH))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
