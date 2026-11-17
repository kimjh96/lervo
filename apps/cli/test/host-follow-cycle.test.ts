import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { readActivationJournal } from "../src/host-cli-activation.js";
import { runFollowCycle } from "../src/host-follow-cycle.js";
import { readActiveCli } from "../src/host-follow-runtime.js";
import { readFollowState, writeFollowControl, writeFollowState } from "../src/host-follow-state.js";
import { applyReleaseUpgrade } from "../src/host-upgrade.js";
import { rollbackActivation } from "../src/host-upgrade-rollback.js";
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

const intent = (tag: string, activationId: string) => ({
  tag,
  activationId,
  startedAt: "2026-11-17T00:00:00.000Z",
  rollback: null,
  interruptions: 0,
});

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
    // The failure was believed when it repeated in a second round; the pass stopped there, and
    // a second pass ran on the restored CLI.
    expect(harness.calls.map((call) => [call.args[2], call.version])).toEqual([
      ["/repositories/one", "9.9.10"],
      ["/repositories/one", "9.9.10"],
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

  it("settles an activation a crashed follower left in flight before it hands over", async () => {
    const harness = await settledHarness();
    const oldRoot = harness.running.root;
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
        rollback: null,
        interruptions: 0,
      },
    });
    // The service restarted the old runtime: its runtime link was never moved to the new one.
    harness.behavior.current = readinessFailsOn("9.9.10");
    const result = await runFollowCycle(harness.dependencies);
    expect(result).toMatchObject({
      outcome: "rolled_back",
      activationId: installed.activation.activationId,
      handover: false,
    });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.9");
    expect(await readlink(harness.layout.follow.runtimePointer)).toBe(oldRoot);
    expect((await readFollowState(harness.layout)).inFlight).toBeNull();
  });

  it("owns only the activation id its intent chose before the install", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    const intended = `hact_${"f".repeat(24)}`;
    const state = await readFollowState(harness.layout);
    // The intent was written, the links switched, and the process died before settling.
    await writeFollowState(harness.layout, {
      ...state,
      inFlight: intent("v9.9.10", intended),
    });
    await applyReleaseUpgrade(harness.source, "v9.9.10", {
      ...harness.upgrade,
      newActivationId: () => intended,
    });
    harness.behavior.current = readinessFailsOn("9.9.10");
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "rolled_back",
      activationId: intended,
    });
    expect((await readFollowState(harness.layout)).failedTags.map((entry) => entry.tag)).toEqual([
      "v9.9.10",
    ]);
  });

  it("never adopts the owner's manual activation of the tag a stale intent names", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    // The follower was stopped during its install; its chosen id never reached the journal.
    const state = await readFollowState(harness.layout);
    await writeFollowState(harness.layout, {
      ...state,
      inFlight: intent("v9.9.10", `hact_${"e".repeat(24)}`),
    });
    const manual = await applyReleaseUpgrade(harness.source, "v9.9.10", harness.upgrade);
    if (manual.status !== "activated") throw new Error("expected an activation");
    harness.behavior.current = readinessFailsOn("9.9.10");
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "install_abandoned",
    });
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({ outcome: "handover" });
    await harness.runActive();
    const reported = await runFollowCycle(harness.dependencies);
    expect(reported).toMatchObject({ outcome: "repositories_upgraded" });
    expect(reported.pass?.outcome).toBe("host_failure");
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.10");
    expect((await readFollowState(harness.layout)).failedTags).toEqual([]);
  });

  it("reconciles its own pending record instead of leaving switched links unowned", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    const intended = `hact_${"d".repeat(24)}`;
    await applyReleaseUpgrade(harness.source, "v9.9.10", {
      ...harness.upgrade,
      newActivationId: () => intended,
    });
    // A crash between the link switch and the journal settling leaves the record pending.
    const journal = JSON.parse(await readFile(harness.layout.journalPath, "utf8"));
    journal.activations.at(-1).outcome = "pending";
    await writeFile(harness.layout.journalPath, JSON.stringify(journal));
    const state = await readFollowState(harness.layout);
    await writeFollowState(harness.layout, { ...state, inFlight: intent("v9.9.10", intended) });
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "install_abandoned",
      activationId: intended,
    });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.9");
    expect((await readActivationJournal(harness.layout)).at(-1)).toMatchObject({
      activationId: intended,
      outcome: "restored",
    });
  });

  it("converges after a rollback that finished before a crash recorded it", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    const installed = await applyReleaseUpgrade(harness.source, "v9.9.10", harness.upgrade);
    if (installed.status !== "activated") throw new Error("expected an activation");
    const id = installed.activation.activationId;
    const state = await readFollowState(harness.layout);
    await writeFollowState(harness.layout, {
      ...state,
      inFlight: { ...intent("v9.9.10", id), rollback: { code: "node_fleet_readiness_timeout" } },
    });
    await rollbackActivation(id, true, harness.upgrade);
    const result = await runFollowCycle(harness.dependencies);
    expect(result).toMatchObject({ outcome: "rolled_back", activationId: id });
    expect(result.pass?.version).toBe("9.9.9");
    expect(harness.calls.map((call) => call.version)).toEqual(["9.9.9", "9.9.9"]);
    expect((await readFollowState(harness.layout)).inFlight).toBeNull();
  });

  it("keeps a healthy release whose post-activation pruning failed", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    harness.upgrade.readCliPointer = async () => {
      throw Object.assign(new Error("EIO"), { code: "EIO" });
    };
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "upgraded",
      tag: "v9.9.10",
    });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.10");
    expect((await readFollowState(harness.layout)).failedTags).toEqual([]);
  });

  it("retries a rollback that met the host upgrade lock until it succeeds", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    const fail = readinessFailsOn("9.9.10");
    let failures = 0;
    harness.behavior.current = (args, version) => {
      const answer = fail(args, version);
      // A manual host upgrade takes the lock just as the failure is believed.
      if (answer.kind === "failed" && (failures += 1) === 2) {
        mkdirSync(harness.layout.cliDirectory, { recursive: true });
        writeFileSync(harness.layout.lockPath, `${process.pid}\n`);
      }
      return answer;
    };
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "rollback_pending",
      code: "host_upgrade_in_progress",
    });
    let state = await readFollowState(harness.layout);
    expect(state.inFlight?.rollback).toEqual({ code: "node_fleet_readiness_timeout" });
    expect(state.failedTags.map((entry) => entry.tag)).toEqual(["v9.9.10"]);
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.10");
    await rm(harness.layout.lockPath);
    harness.behavior.current = () => upgradeResult("current");
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({ outcome: "rolled_back" });
    state = await readFollowState(harness.layout);
    expect(state.inFlight).toBeNull();
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.9");
  });

  it("backs off a failing install and fails the tag after three attempts", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    harness.upgrade.installer = async () => {
      throw new Error("pnpm: ERR_PNPM_NO_MATCHING_VERSION");
    };
    const outcomes = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await runFollowCycle(harness.dependencies);
      outcomes.push([result.outcome, result.code, result.backoff]);
    }
    expect(outcomes).toEqual([
      ["install_retry", "host_upgrade_install_failed", 1],
      ["install_retry", "host_upgrade_install_failed", 2],
      ["release_failed", "host_upgrade_install_failed", 0],
    ]);
    const downloads = harness.source.downloads;
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "release_failed_on_host",
    });
    expect(harness.source.downloads).toBe(downloads);
  });

  it("treats a stopped or killed lervo upgrade as interrupted, not as a host failure", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    const controller = new AbortController();
    harness.dependencies.signal = controller.signal;
    harness.behavior.current = (args, version) => {
      if (version !== "9.9.10") return upgradeResult("current");
      if (!args.includes("--apply")) return upgradeResult("ready", { planId: "plan" });
      controller.abort();
      return { kind: "interrupted" };
    };
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "interrupted",
      tag: "v9.9.10",
    });
    let state = await readFollowState(harness.layout);
    expect(state.failedTags).toEqual([]);
    expect(state.inFlight).toMatchObject({ tag: "v9.9.10", rollback: null, interruptions: 0 });
    expect((await readActiveCli(harness.layout)).version).toBe("9.9.10");

    // Restarted without a stop request, a child that keeps dying counts; the third is believed.
    harness.dependencies.signal = undefined;
    harness.behavior.current = (args, version) =>
      version === "9.9.10" && args.includes("--apply")
        ? { kind: "interrupted" }
        : version === "9.9.10"
          ? upgradeResult("ready", { planId: "plan" })
          : upgradeResult("current");
    for (const interruptions of [1, 2]) {
      expect(await runFollowCycle(harness.dependencies)).toMatchObject({
        outcome: "interrupted",
        code: "host_follow_repository_upgrade_interrupted",
      });
      state = await readFollowState(harness.layout);
      expect(state.inFlight?.interruptions).toBe(interruptions);
    }
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({
      outcome: "rolled_back",
      code: "host_follow_repository_upgrade_interrupted",
    });
  });

  it("retries a failed repository later and leaves an unchanged blocked plan alone", async () => {
    const harness = await settledHarness();
    harness.releases.push(release("9.9.10"));
    let healthy = false;
    harness.behavior.current = (args, version) => {
      if (version !== "9.9.10") return upgradeResult("current");
      if (args[2] === "/repositories/two")
        return args.includes("--apply")
          ? upgradeResult("blocked", { planId: "plan_b" })
          : upgradeResult("blocked", { planId: "plan_b", applicableStages: ["knowledge"] });
      if (!args.includes("--apply")) return upgradeResult("ready", { planId: "plan" });
      return healthy
        ? upgradeResult("current", { timing: { admissionWaitMs: 1_500, applyMs: 6_000 } })
        : { kind: "failed", code: "knowledge_cycle_admission_wait_expired" };
    };
    const first = await runFollowCycle(harness.dependencies);
    expect(
      first.pass?.repositories.map((repository) => [
        repository.outcome,
        repository.attempts,
        repository.nextAttemptAt,
      ]),
    ).toEqual([
      ["failed", 1, "2026-11-17T00:10:00.000Z"],
      ["blocked", 0, "2026-11-17T01:00:00.000Z"],
    ]);
    await harness.runActive();
    harness.calls.splice(0);
    expect(await runFollowCycle(harness.dependencies)).toMatchObject({ outcome: "current" });
    expect(harness.calls).toHaveLength(0);

    healthy = true;
    harness.upgrade.now = () => new Date("2026-11-17T01:00:00.000Z");
    const retried = await runFollowCycle(harness.dependencies);
    expect(retried.outcome).toBe("repositories_retried");
    expect(retried.pass?.repositories[0]).toMatchObject({
      outcome: "current",
      attempts: 0,
      nextAttemptAt: null,
      waitMs: 1_500,
      applyMs: 6_000,
    });
    expect(retried.pass?.repositories[1]).toMatchObject({
      outcome: "blocked",
      code: "upgrade_plan_unchanged",
    });
    expect(
      harness.calls.filter(
        (call) => call.args[2] === "/repositories/two" && call.args.includes("--apply"),
      ),
    ).toHaveLength(0);
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
