import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { formatFollowStatus } from "../src/host-follow-format.js";
import {
  emptyFollowControl,
  readFollowState,
  type HostFollowState,
} from "../src/host-follow-state.js";
import { hostUpgradeLayout } from "../src/host-upgrade-layout.js";

import {
  formatFailureDetail,
  repositoryUpgradeFailureDetail,
  validFailureDetail,
} from "../src/host-follow-failure-detail.js";
import { parseRepositoryUpgradeOutput } from "../src/host-repository-upgrade-runner.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

/** ADR-0575: a failed upgrade keeps a bounded, text-free detail of why it failed. */
describe("repository upgrade failure detail", () => {
  const readiness = {
    baseline: "observed",
    lastStatus: "starting",
    lastProcessId: 2350753,
    observations: 288,
    blockers: [{ component: "supervision", observed: "pending", baseline: "ready" }],
  };

  it("keeps the readiness detail of a failed envelope, and nothing else", () => {
    const parsed = parseRepositoryUpgradeOutput(
      JSON.stringify({
        schemaVersion: 1,
        status: "failed",
        error: {
          code: "node_fleet_readiness_timeout",
          message: "The Node runtime did not become ready: supervision pending (/home/someone).",
          readiness,
          recovery: "restored",
          token: "secret",
        },
      }),
    );
    expect(parsed).toEqual({
      kind: "failed",
      code: "node_fleet_readiness_timeout",
      failure: { readiness, recovery: "restored" },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/someone|secret|did not become/u);
    // A failure without a detail stays as it was.
    expect(
      parseRepositoryUpgradeOutput(
        JSON.stringify({ status: "failed", error: { code: "x_failed" } }),
      ),
    ).toEqual({ kind: "failed", code: "x_failed" });
  });

  it("bounds blockers and drops anything of an unexpected shape", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      component: "supervision",
      observed: index === 0 ? "pending\nrm -rf" : "unavailable:hub_unavailable",
      baseline: null,
    }));
    const detail = repositoryUpgradeFailureDetail({
      readiness: { ...readiness, blockers: many },
      failedCode: "Not A Code",
    });
    expect(detail?.readiness?.blockers).toHaveLength(7);
    expect(detail?.failedCode).toBeUndefined();
    expect(repositoryUpgradeFailureDetail({ readiness: { ...readiness, observations: -1 } })).toBe(
      undefined,
    );
    expect(repositoryUpgradeFailureDetail("text")).toBeUndefined();
  });

  it("accepts in state only a detail this CLI writes, with the repository where required", () => {
    const detail = { readiness, recovery: "restored" };
    expect(validFailureDetail(detail, false)).toBe(true);
    expect(validFailureDetail({ ...detail, repositoryRoot: "/r" }, true)).toBe(true);
    expect(validFailureDetail(detail, true)).toBe(false);
    expect(validFailureDetail({ ...detail, repositoryRoot: "/r" }, false)).toBe(false);
    expect(validFailureDetail({ ...detail, message: "free text" }, false)).toBe(false);
    expect(validFailureDetail({ readiness: { ...readiness, lastStatus: 3 } }, false)).toBe(false);
  });

  it("formats one line with the blockers and the recovery", () => {
    expect(formatFailureDetail({ readiness, recovery: "restored" })).toBe(
      "readiness starting after 288 observations, baseline observed; blockers: supervision pending (was ready); recovery restored",
    );
  });

  it("round-trips a failed tag's detail in follower state, rejects a forged one, and shows it", async () => {
    const home = await mkdtemp(join(tmpdir(), "lervo-follow-detail-"));
    homes.push(home);
    const layout = hostUpgradeLayout({ homeDirectory: home, platform: "linux" });
    await mkdir(dirname(layout.follow.statePath), { recursive: true });
    const failure = { repositoryRoot: "/repositories/axli", readiness, recovery: "restored" };
    const state = {
      schemaVersion: 1,
      repository: null,
      lastCheckAt: null,
      lastSeenTag: null,
      consecutiveSourceFailures: 0,
      lastOutcome: null,
      failedTags: [
        {
          tag: "v0.30.0",
          failedAt: "2026-11-21T18:38:19.718Z",
          code: "node_fleet_readiness_timeout",
          activationId: "hact_58950825ca702c7244666d33",
          failure,
        },
      ],
      inFlight: null,
      installFailures: null,
      lastPass: null,
    };
    await writeFile(layout.follow.statePath, JSON.stringify(state));
    const read = await readFollowState(layout);
    expect(read.failedTags[0]?.failure).toEqual(failure);
    expect(
      formatFollowStatus({
        state: read as HostFollowState,
        control: emptyFollowControl(),
        activeVersion: "0.29.10",
        service: null,
        serviceDefinition: { status: "missing" } as never,
        holds: [],
      }),
    ).toContain(
      "failed on this host: v0.30.0 (node_fleet_readiness_timeout) at 2026-11-21T18:38:19.718Z; /repositories/axli: readiness starting after 288 observations, baseline observed; blockers: supervision pending (was ready); recovery restored",
    );
    // An older state file without the detail stays valid; a forged detail does not.
    const { failure: _omitted, ...older } = state.failedTags[0]!;
    await writeFile(layout.follow.statePath, JSON.stringify({ ...state, failedTags: [older] }));
    expect((await readFollowState(layout)).failedTags).toEqual([older]);
    await writeFile(
      layout.follow.statePath,
      JSON.stringify({
        ...state,
        failedTags: [{ ...older, failure: { ...failure, message: "free text" } }],
      }),
    );
    await expect(readFollowState(layout)).rejects.toMatchObject({
      code: "host_follow_state_invalid",
    });
  });
});
