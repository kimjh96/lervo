import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as knowledge from "@lervo/repository-knowledge";
import { listAssignments, listWorkspaces } from "@lervo/agent-workforce";
import { planWorkspaceCleanup } from "@lervo/orchestrator";
import { GitWorkspaceHostAdapter } from "@lervo/workspace-host-git";
import * as workspace from "../src/canonical-workspace.js";
import { KnowledgeConvergenceRuntimeError } from "../src/failure.js";
import { createConvergenceRuntimeHost } from "../src/host.js";
import { compactConvergenceWorkspaces } from "../src/workspace-retention.js";
import {
  CANONICAL_SOURCE,
  CANONICAL_TARGET,
  INTEGRATED_REQUIREMENT,
  canonicalIntegrationFixture,
} from "./canonical-integration-fixture.js";

const harnesses: Awaited<ReturnType<typeof canonicalIntegrationFixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { f } of harnesses.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function harness(options?: Parameters<typeof canonicalIntegrationFixture>[0]) {
  const created = await canonicalIntegrationFixture(options);
  harnesses.push(created);
  return created;
}

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

function canonicalizations(f: Awaited<ReturnType<typeof harness>>["f"]) {
  return f.events
    .list({ limit: 1000 })
    .filter(
      (event) =>
        event.type === "knowledge.materialization.applied" &&
        event.payload.operation === "canonicalize",
    );
}

/** The first root apply fails as an interrupted publication would, after the ref integrated. */
function interruptFirstRootApply() {
  const apply = knowledge.applyDurableKnowledgeOperations;
  const interruption = { happened: false };
  vi.spyOn(knowledge, "applyDurableKnowledgeOperations").mockImplementation(async (input) => {
    if (
      !interruption.happened &&
      input.operations.some(
        (item) =>
          "content" in item &&
          typeof item.content === "string" &&
          item.content.includes(INTEGRATED_REQUIREMENT),
      )
    ) {
      interruption.happened = true;
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    }
    return apply(input);
  });
  return interruption;
}

it.each(["present", "absent"] as const)(
  "integrates a reviewed canonical draft through isolated workspaces and verifies actual repository bytes when the integration ref is %s",
  { timeout: 60_000 },
  async (integrationRef) => {
    // A delegation seeded on another host names a branch that this host never created.
    const { f, integrate } = await harness({ integrationRef });
    expect(await integrate()).toMatchObject({
      state: "current",
      nextStage: "normalization_generation",
      failureCode: null,
    });
    const actual = await readFile(resolve(f.root, CANONICAL_TARGET), "utf8");
    expect(actual).toContain(INTEGRATED_REQUIREMENT);
    const integrated = execFileSync(
      "git",
      ["-C", f.root, "show", `refs/heads/knowledge-integration:${CANONICAL_TARGET}`],
      { encoding: "utf8" },
    );
    expect(integrated).toBe(actual);
    expect(canonicalizations(f)).toHaveLength(1);
  },
);

it(
  "parks a source whose draft meets a dirty canonical target without starting a writer",
  { timeout: 60_000 },
  async () => {
    const requirement = "Preserve this exact uncommitted user requirement.";
    const { f, integrate } = await harness({ ownerTargetEdit: `\n${requirement}\n` });
    const dirty = await readFile(resolve(f.root, CANONICAL_TARGET), "utf8");
    // ADR-0530: the divergent draft parks its source and the obligation continues.
    const result = await integrate();
    expect(result).toMatchObject({
      state: "current",
      nextStage: "normalization_generation",
      failureCode: null,
    });
    expect(result.input.stageData.parkedSources).toEqual([
      expect.objectContaining({
        stage: "canonical",
        path: CANONICAL_SOURCE,
        reason: "target_diverged",
        attempts: 1,
      }),
    ]);
    expect(await readFile(resolve(f.root, CANONICAL_TARGET), "utf8")).toBe(dirty);
    expect(dirty).toContain(requirement);
    expect(
      (await listAssignments(f.root)).some(
        (item) => item.convergence?.stage === "canonical_integration",
      ),
    ).toBe(false);
    expect(canonicalizations(f)).toHaveLength(0);
  },
);

it(
  "reuses durable provision and seal plans without a second workspace or commit",
  { timeout: 60_000 },
  async () => {
    const { f, integrate, settleObligation, runRetentionTurn } = await harness();
    const seal = workspace.sealCanonicalDrafts;
    vi.spyOn(workspace, "sealCanonicalDrafts").mockImplementation(async (...args) => {
      const first = await seal(...args);
      expect(await seal(...args)).toEqual(first);
      return first;
    });
    expect(await integrate()).toMatchObject({ state: "current" });
    expect(workspace.sealCanonicalDrafts).toHaveBeenCalledOnce();
    const workspaces = await listWorkspaces(f.root);
    expect(workspaces).toHaveLength(2);
    expect(
      workspaces.find((item) => item.executionKind === "worker")!.sealedResult!.commitIds,
    ).toHaveLength(1);
    expect(
      workspaces.every((item) => item.state === "integrated" && item.writerSession === null),
    ).toBe(true);
    // ADR-0518: the owner's next turn retires every checkout of the settled obligation.
    settleObligation();
    expect(await runRetentionTurn()).toMatchObject({ status: "processed" });
    const remaining = (await listWorkspaces(f.root)).filter((item) => item.state !== "removed");
    const blocked = await Promise.all(
      remaining.map((item) =>
        planWorkspaceCleanup({
          coordinates: {
            repositoryRoot: f.root,
            workspacePath: item.ownerWorkspacePath!,
            integrationTargetRef: "refs/heads/knowledge-integration",
          },
          workspaceId: item.workspaceId,
          host: new GitWorkspaceHostAdapter(),
        }),
      ),
    );
    expect(remaining, JSON.stringify(blocked.map((item) => item.blockedReasons))).toHaveLength(0);
    expect(workspaces.every((item) => !existsSync(item.ownerWorkspacePath!))).toBe(true);
    await expect(readFile(f.log)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it(
  "resumes a verified ref integration before root apply under a new exact lease",
  { timeout: 60_000 },
  async () => {
    const { f, state, context, integrate } = await harness();
    const interruption = interruptFirstRootApply();
    const uncertain = (await integrate().catch((error: unknown) => error)) as {
      code?: string;
      dependencyHash?: string;
    };
    expect(uncertain).toMatchObject({ code: "knowledge_effect_uncertain" });
    expect(interruption.happened).toBe(true);
    expect(await readFile(resolve(f.root, CANONICAL_TARGET), "utf8")).not.toContain(
      INTEGRATED_REQUIREMENT,
    );
    const ref = git(f.root, "rev-parse", "knowledge-integration");
    expect(git(f.root, "show", `${ref}:${CANONICAL_TARGET}`)).toContain(INTEGRATED_REQUIREMENT);
    const failed = (await listAssignments(f.root)).find(
      (item) => item.taskType === "repository.integration",
    )!;
    expect(failed).toMatchObject({ status: "failed", lease: null, lastLeaseGeneration: 1 });

    // The owner settles the failure as `recovery_required` with this dependency. The runtime host
    // holds it while the ref integration cannot be verified and releases it once it can.
    const host = createConvergenceRuntimeHost(context);
    const dependency = await f.artifacts.put(
      knowledge.canonicalJson({
        schemaVersion: 1,
        kind: "stage_failure",
        code: uncertain.code,
        evaluationContract: host.evaluationContract,
        snapshotHash: state.snapshotHash,
        delegationHash: state.baseline.delegationHash,
        evidenceHash: uncertain.dependencyHash,
      }),
    );
    const base = git(f.root, "rev-list", "--max-parents=0", "HEAD");
    git(f.root, "update-ref", "refs/heads/knowledge-integration", base);
    expect(await host.dependencyCurrent(dependency.contentHash)).toBe(true);
    git(f.root, "update-ref", "refs/heads/knowledge-integration", ref);
    expect(await host.dependencyCurrent(dependency.contentHash)).toBe(false);

    // Released, the owner redelivers the same stage input.
    expect(await integrate()).toMatchObject({ state: "current", failureCode: null });
    expect(git(f.root, "rev-parse", "knowledge-integration")).toBe(ref);
    expect(await readFile(resolve(f.root, CANONICAL_TARGET), "utf8")).toContain(
      INTEGRATED_REQUIREMENT,
    );
    expect(
      (await listAssignments(f.root)).find((item) => item.assignmentId === failed.assignmentId),
    ).toMatchObject({
      status: "completed",
      lease: null,
      lastLeaseGeneration: 2,
      recovery: { attemptNumber: 2 },
    });
    expect(canonicalizations(f)).toHaveLength(1);
  },
);

it(
  "retires a failed attempt's dirty draft checkout once its obligation settles",
  { timeout: 60_000 },
  async () => {
    const { f, integrate, settleObligation, runRetentionTurn } = await harness();
    const interruption = interruptFirstRootApply();
    await expect(integrate()).rejects.toMatchObject({ code: "knowledge_effect_uncertain" });
    expect(interruption.happened).toBe(true);
    const failed = (await listAssignments(f.root)).find(
      (item) => item.taskType === "repository.integration",
    )!;
    expect(failed).toMatchObject({ status: "failed", lease: null });
    const checkout = (await listWorkspaces(f.root)).find(
      (item) => item.assignmentId === failed.assignmentId,
    )!;
    // A failed verification can leave rewritten bytes behind, as a lockfile install does.
    await writeFile(resolve(checkout.ownerWorkspacePath!, "pnpm-lock.yaml"), "rewritten\n");
    expect(await integrate()).toMatchObject({ state: "current" });

    settleObligation();
    expect(await runRetentionTurn()).toMatchObject({ status: "processed" });
    const removed = (await listWorkspaces(f.root)).find(
      (item) => item.workspaceId === checkout.workspaceId,
    )!;
    expect(removed.state).toBe("removed");
    expect(existsSync(checkout.ownerWorkspacePath!)).toBe(false);
    expect((await listWorkspaces(f.root)).filter((item) => item.state !== "removed")).toHaveLength(
      0,
    );
  },
);

it(
  "retires integrated checkouts on a non-owner host after the target was absorbed",
  { timeout: 60_000 },
  async () => {
    const { f, integrate, settleObligation, runRetentionTurn } = await harness();
    expect(await integrate()).toMatchObject({ state: "current" });
    const integrated = await listWorkspaces(f.root);
    expect(integrated.length).toBeGreaterThan(0);
    expect(integrated.every((item) => item.state === "integrated")).toBe(true);
    settleObligation();
    // ADR-0482 absorption moves the target to a base that never contained the sealed heads.
    const base = git(f.root, "rev-list", "--max-parents=0", "HEAD");
    git(f.root, "update-ref", "refs/heads/knowledge-integration", base);

    // Checkouts are host-local, so a host that no longer owns convergence still retires its own.
    expect(
      await runRetentionTurn(
        async () => ({ role: "waiting_owner", reason: "convergence_owner_elsewhere" }) as never,
      ),
    ).toMatchObject({ status: "waiting_owner" });
    const after = await listWorkspaces(f.root);
    expect(after.every((item) => item.state === "removed")).toBe(true);
    expect(integrated.every((item) => !existsSync(item.ownerWorkspacePath!))).toBe(true);
    expect(await compactConvergenceWorkspaces(f.storage)).toBe(0);
  },
);
