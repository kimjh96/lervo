import { describe, expect, it } from "vitest";

import { dueRepositories, mergeRepositoryResults } from "../src/host-follow-due.js";
import type { ActiveCli } from "../src/host-follow-runtime.js";
import type {
  HostFollowPass,
  HostFollowRepositoryResult,
  HostFollowState,
} from "../src/host-follow-state.js";

const now = new Date("2026-11-28T01:00:00.000Z");
const active = { target: "/cli/1.0.0" } as ActiveCli;

const entry = (
  repositoryRoot: string,
  overrides: Partial<HostFollowRepositoryResult> = {},
): HostFollowRepositoryResult => ({
  repositoryRoot,
  outcome: "current",
  status: "current",
  code: null,
  rounds: 1,
  appliedStages: [],
  pendingStages: [],
  planId: null,
  attempts: 0,
  nextAttemptAt: null,
  waitMs: null,
  applyMs: null,
  elapsedMs: 10,
  ...overrides,
});

const stateWith = (pass: Partial<HostFollowPass>): HostFollowState =>
  ({
    lastPass: {
      cliTarget: "/cli/1.0.0",
      version: "1.0.0",
      finishedAt: "2026-11-28T00:00:00.000Z",
      outcome: "current",
      repositories: [],
      ...pass,
    },
  }) as HostFollowState;

describe("dueRepositories", () => {
  it("owes a newly registered repository a run before one left in Lervo debt", () => {
    const state = stateWith({
      outcome: "blocked",
      repositories: [
        entry("/a", {
          outcome: "blocked",
          code: "upgrade_lervo_debt",
          nextAttemptAt: "2026-11-28T00:30:00.000Z",
        }),
        entry("/gone", { outcome: "failed", nextAttemptAt: "2026-11-28T00:30:00.000Z" }),
      ],
    });
    expect(dueRepositories(state, active, now, ["/a", "/new"])).toEqual(["/new", "/a"]);
  });

  it("leaves repositories after a host failure to the next CLI", () => {
    const state = stateWith({
      outcome: "host_failure",
      repositories: [entry("/a", { outcome: "host_failure", nextAttemptAt: null })],
    });
    expect(dueRepositories(state, active, now, ["/a", "/b"])).toEqual([]);
  });

  it("owes nothing for a CLI the last pass did not run", () => {
    expect(dueRepositories(stateWith({ cliTarget: "/cli/0.9.0" }), active, now, ["/a"])).toEqual(
      [],
    );
  });
});

describe("mergeRepositoryResults", () => {
  it("replaces results in place, appends new ones, and drops unregistered entries", () => {
    const merged = mergeRepositoryResults(
      [entry("/a", { attempts: 1 }), entry("/gone"), entry("/b")],
      [entry("/new"), entry("/a")],
      ["/a", "/b", "/new"],
    );
    expect(merged.map((item) => [item.repositoryRoot, item.attempts])).toEqual([
      ["/a", 0],
      ["/b", 0],
      ["/new", 0],
    ]);
  });
});
