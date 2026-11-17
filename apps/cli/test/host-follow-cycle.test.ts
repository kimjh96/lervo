import { mkdir, readlink, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { readActivationJournal } from "../src/host-cli-activation.js";
import { runFollowCycle } from "../src/host-follow-cycle.js";
import { readActiveCli } from "../src/host-follow-runtime.js";
import { readFollowState, writeFollowControl, writeFollowState } from "../src/host-follow-state.js";
import { applyReleaseUpgrade } from "../src/host-upgrade.js";
import {
  cleanDirectories,
  followHarness,
  release,
  upgradeResult,
  type FollowHarness,
  type RepositoryBehavior,
} from "./host-follow-fixture.js";

afterEach(cleanDirectories);

/** A host whose first follow cycle already ran the repository pass for v9.9.9. */
async function settledHarness(): Promise<FollowHarness> {
  const harness = await followHarness();
  const first = await runFollowCycle(harness.dependencies);
  expect(first).toMatchObject({ outcome: "repositories_upgraded", handover: false });
  harness.calls.splice(0);
  return harness;
}

const readinessFailsOn =
  (version: string): RepositoryBehavior =>
  (args, activeVersion) => {
    if (activeVersion !== version || args[2] !== "/repositories/one")
      return upgradeResult("current");
    return args.includes("--apply")
      ? { kind: "failed", code: "node_fleet_readiness_timeout" }
      : upgradeResult("ready", { planId: "plan_node" });
  };

describe("runFollowCycle", () => {
  it("installs only the newest release, upgrades every repository, and hands over", async () => {
    const harness = await settledHarness();
    const oldRoot = harness.running.root;
    harness.releases.push(release("9.9.10"), release("9.9.11"));
    const result = await runFollowCycle(harness.dependencies);
    expect(result).toMatchObject({ outcome: "upgraded", tag: "v9.9.11", handover: true });
    expect(result.activationId).toMatch(/^hact_/u);
    const active = await readActiveCli(harness.layout);
    expect(active.version).toBe("9.9.11");
    expect(active.packageRoot).not.toBe(oldRoot);
    // The service restarts on the package the link runs, through the follower's runtime link.
    expect(await readlink(harness.layout.follow.runtimePointer)).toBe(active.packageRoot);
    expect(harness.calls.map((call) => [call.args[2], call.version])).toEqual([
      ["/repositories/one", "9.9.11"],
      ["/repositories/two", "9.9.11"],
    ]);
    const state = await readFollowState(harness.layout);
    expect(state).toMatchObject({ inFlight: null, lastSeenTag: "v9.9.11" });
    expect(state.lastPass).toMatchObject({ version: "9.9.11", outcome: "current" });

    // The old process exits; until the service restarts it, every cycle only hands over.
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({ outcome: "handover" });
    await harness.runActive();
    const downloads = harness.source.downloads;
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "current",
      tag: "v9.9.11",
      handover: false,
    });
    expect(harness.source.downloads).toBe(downloads);
    expect(harness.calls).toHaveLength(2);
  });

  it("marks a release whose health gate failed and never installs it again", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10", "process.exit(3);\n"));
    const result = await runFollowCycle(harness.dependencies);
    expect(result).toMatchObject({
      outcome: "release_failed",
      tag: "v9.9.10",
      code: "host_upgrade_health_failed",
    });
    const journal = await readActivationJournal(harness.layout);
    expect(journal.at(-1)).toMatchObject({
      activationId: result.activationId,
      outcome: "restored",
    });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.9");
    expect((await readFollowState(harness.layout)).failedTags).toEqual([
      {
        tag: "v9.9.10",
        failedAt: "2026-11-17T00:00:00.000Z",
        code: "host_upgrade_health_failed",
        activationId: result.activationId,
      },
    ]);
    const downloads = harness.source.downloads;
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "release_failed_on_host",
      tag: "v9.9.10",
    });
    expect(harness.source.downloads).toBe(downloads);
    expect(harness.calls).toHaveLength(0);
  });

  it("rolls back by id when Node readiness fails and converges on the restored CLI", async () => {
    const harness = await settledHarness();
    harness.behavior.current = readinessFailsOn("9.9.10");
    harness.releases.push(release("9.9.10"));
    const result = await runFollowCycle(harness.dependencies);
    expect(result).toMatchObject({
      outcome: "rolled_back",
      tag: "v9.9.10",
      code: "node_fleet_readiness_timeout",
      handover: false,
    });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.9");
    const journal = await readActivationJournal(harness.layout);
    expect(journal.at(-1)).toMatchObject({
      kind: "rollback",
      outcome: "active",
      rolledBackActivationId: result.activationId,
    });
    // The pass stopped at the failing repository; a second pass ran on the restored CLI.
    expect(harness.calls.map((call) => [call.args[2], call.version])).toEqual([
      ["/repositories/one", "9.9.10"],
      ["/repositories/one", "9.9.10"],
      ["/repositories/one", "9.9.9"],
      ["/repositories/two", "9.9.9"],
    ]);
    const state = await readFollowState(harness.layout);
    expect(state.failedTags.map((entry) => [entry.tag, entry.activationId])).toEqual([
      ["v9.9.10", result.activationId],
    ]);
    expect(state.lastPass).toMatchObject({ version: "9.9.9", outcome: "current" });
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "release_failed_on_host",
    });
  });

  it("reports repository content blocks without rolling the host back", async () => {
    const harness = await settledHarness();
    harness.behavior.current = (args, version) =>
      version === "9.9.10" && args[2] === "/repositories/two"
        ? upgradeResult("blocked")
        : upgradeResult("current");
    harness.releases.push(release("9.9.10"));
    const result = await runFollowCycle(harness.dependencies);
    expect(result).toMatchObject({ outcome: "upgraded", handover: true });
    expect(result.pass?.outcome).toBe("blocked");
    expect(result.pass?.repositories[1]).toMatchObject({
      outcome: "blocked",
      code: "upgrade_plan_blocked",
    });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.10");
    expect((await readFollowState(harness.layout)).failedTags).toEqual([]);
  });

  it("holds following while paused and installs only the pinned release", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"), release("9.9.11"));
    await writeFollowControl(harness.layout, {
      schemaVersion: 1,
      paused: true,
      pinnedTag: null,
      changedAt: "t",
    });
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({ outcome: "paused" });
    expect(harness.source.listings).toBe(0);
    await writeFollowControl(harness.layout, {
      schemaVersion: 1,
      paused: false,
      pinnedTag: "v9.9.10",
      changedAt: "t",
    });
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "upgraded",
      tag: "v9.9.10",
    });
    await harness.runActive();
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "pinned_release_reached",
      tag: "v9.9.10",
    });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.10");
  });

  it("backs off on release-source failures and recovers", async () => {
    const harness = await settledHarness();
    harness.source.failListing = true;
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "source_unavailable",
      code: "host_release_unavailable",
      consecutiveSourceFailures: 1,
    });
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      consecutiveSourceFailures: 2,
    });
    harness.source.failListing = false;
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "current",
      consecutiveSourceFailures: 0,
    });
  });

  it("hands over after a manual activation, then upgrades repositories without rolling back", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    await applyReleaseUpgrade(harness.source, "v9.9.10", harness.upgrade);
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({ outcome: "handover" });
    expect(harness.calls).toHaveLength(0);
    await harness.runActive();
    harness.behavior.current = readinessFailsOn("9.9.10");
    const result = await runFollowCycle(harness.dependencies);
    // The owner activated this CLI; the follower reports its failure and leaves it active.
    expect(result).toMatchObject({ outcome: "repositories_upgraded", tag: null });
    expect(result.pass?.outcome).toBe("host_failure");
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.10");
  });

  it("lets a restarted follower settle the activation a crashed one left in flight", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    const installed = await applyReleaseUpgrade(harness.source, "v9.9.10", harness.upgrade);
    if (installed.status !== "activated") throw new Error("expected an activation");
    const state = await readFollowState(harness.layout);
    await writeFollowState(harness.layout, {
      ...state,
      inFlight: {
        tag: "v9.9.10",
        activationId: installed.activation.activationId,
        startedAt: "t",
      },
    });
    await harness.runActive();
    harness.behavior.current = readinessFailsOn("9.9.10");
    const result = await runFollowCycle(harness.dependencies);
    expect(result).toMatchObject({
      outcome: "rolled_back",
      activationId: installed.activation.activationId,
      // This process runs the rolled-back CLI, so it hands over to the restored one.
      handover: true,
    });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.9");
  });

  it("waits for a manual host upgrade that holds the lock without failing the tag", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    await mkdir(harness.layout.cliDirectory, { recursive: true });
    await writeFile(harness.layout.lockPath, `${process.pid}\n`);
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "busy",
      code: "host_upgrade_in_progress",
    });
    expect((await readFollowState(harness.layout)).failedTags).toEqual([]);
  });
});
