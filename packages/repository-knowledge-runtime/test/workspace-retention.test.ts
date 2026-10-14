import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as knowledge from "@lervo/repository-knowledge";
import {
  listAssignments,
  listWorkspaces,
  type AgentWorkspace,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import { KnowledgeConvergenceRuntimeError } from "../src/failure.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import {
  compactConvergenceWorkspaces,
  convergenceWorkspaceRetirement,
} from "../src/workspace-retention.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function run(f: Awaited<ReturnType<typeof fixture>>) {
  return runAutonomousKnowledgeWorker({
    storage: f.storage,
    provider: "claude",
    workerId: "retention",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
  });
}

async function converge(f: Awaited<ReturnType<typeof fixture>>) {
  for (let i = 0; i < 8; i++) {
    const result = await run(f);
    if (result.status === "processed" && result.convergence.lastVerifiedCurrency) return result;
  }
  throw new Error("Convergence did not settle.");
}

describe("convergence workspace retirement decision", () => {
  const ownedRoot = "/repository/.lervo/state/knowledge/convergence-workspaces";
  const workspace = (overrides: Partial<AgentWorkspace> = {}) =>
    ({
      workspaceId: "wsp_0123456789abcdef01234567",
      assignmentId: "asn_0123456789abcdef01234567",
      leaseGeneration: 1,
      executionKind: "worker",
      state: "active",
      host: { kind: "git", version: "1.0.0" },
      ownerWorkspacePath: `${ownedRoot}/asn_0123456789abcdef01234567/lease-1/worker`,
      sealedResult: null,
      ...overrides,
    }) as AgentWorkspace;
  const assignment = (overrides: Partial<WorkforceAssignment> = {}) =>
    ({
      assignmentId: "asn_0123456789abcdef01234567",
      convergence: { obligationId: "kconv_0123456789abcdef01234567" },
      status: "failed",
      lease: null,
      lastLeaseGeneration: 1,
      recovery: null,
      ...overrides,
    }) as unknown as WorkforceAssignment;
  const decide = (
    w: AgentWorkspace,
    a: WorkforceAssignment | undefined,
    obligationSettled = false,
  ) =>
    convergenceWorkspaceRetirement({ workspace: w, assignment: a, obligationSettled, ownedRoot });

  it("retires settled, closed, and superseded checkouts", () => {
    expect(
      decide(workspace({ state: "integrated" }), assignment({ status: "completed" }), true),
    ).toBe("obligation_settled");
    expect(decide(workspace(), assignment({ status: "cancelled" }))).toBe("assignment_closed");
    expect(decide(workspace(), assignment({ recovery: { attemptNumber: 16 } } as never))).toBe(
      "assignment_closed",
    );
    expect(
      decide(workspace(), assignment({ status: "leased", lease: { generation: 2 } } as never)),
    ).toBe("lease_superseded");
    expect(decide(workspace(), assignment({ lastLeaseGeneration: 2 }))).toBe("lease_superseded");
  });

  it("retains every checkout a later effect can still read", () => {
    // A failed attempt that may still be reopened keeps its checkout until a new lease replaces it.
    expect(decide(workspace(), assignment())).toBeNull();
    // A live lease keeps even a settled obligation's checkout.
    expect(
      decide(
        workspace(),
        assignment({ status: "leased", lease: { generation: 1 } } as never),
        true,
      ),
    ).toBeNull();
    // A sealed result may still be integrated by a resumed integrator.
    expect(
      decide(
        workspace({ state: "sealed", sealedResult: {} as never }),
        assignment({ status: "completed", lastLeaseGeneration: 2 }),
      ),
    ).toBeNull();
    expect(decide(workspace({ state: "removing" }), assignment(), true)).toBeNull();
    expect(decide(workspace(), undefined, true)).toBeNull();
    expect(decide(workspace(), assignment({ convergence: null } as never), true)).toBeNull();
    expect(
      decide(workspace({ ownerWorkspacePath: "/elsewhere/worker" }), assignment(), true),
    ).toBeNull();
    expect(
      decide(
        workspace({
          ownerWorkspacePath: `${ownedRoot}/asn_0123456789abcdef01234567/lease-2/worker`,
        }),
        assignment(),
        true,
      ),
    ).toBeNull();
  });
});

it(
  "retires integrated checkouts on a non-owner host after the target was absorbed",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true, true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 3;\n",
    );
    vi.spyOn(
      await import("../src/workspace-retention.js"),
      "compactConvergenceWorkspaces",
    ).mockResolvedValue(0);
    await converge(f);
    vi.restoreAllMocks();
    const integrated = await listWorkspaces(f.root);
    expect(integrated.length).toBeGreaterThan(0);
    expect(integrated.every((item) => item.state === "integrated")).toBe(true);
    // ADR-0482 absorption moves the target to a base that never contained the sealed heads.
    const base = execFileSync("git", ["-C", f.root, "rev-list", "--max-parents=0", "HEAD"], {
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["-C", f.root, "update-ref", "refs/heads/knowledge-integration", base]);

    // Checkouts are host-local, so a host that no longer owns convergence still retires its own.
    expect(
      await runAutonomousKnowledgeWorker({
        storage: f.storage,
        provider: "claude",
        workerId: "retention",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        owner: async () =>
          ({ role: "waiting_owner", reason: "convergence_owner_elsewhere" }) as never,
      }),
    ).toMatchObject({ status: "waiting_owner" });
    const after = await listWorkspaces(f.root);
    expect(after.every((item) => item.state === "removed")).toBe(true);
    expect(integrated.every((item) => !existsSync(item.ownerWorkspacePath!))).toBe(true);
    expect(await compactConvergenceWorkspaces(f.storage)).toBe(0);
  },
);

it(
  "retires a failed attempt's dirty draft checkout once its obligation settles",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true, true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "src/runtime.ts"),
      "export const maximumBackgroundCalls = 3;\n",
    );
    const apply = knowledge.applyDurableKnowledgeOperations;
    let interrupted = false;
    vi.spyOn(knowledge, "applyDurableKnowledgeOperations").mockImplementation(async (input) => {
      if (
        !interrupted &&
        input.operations.some(
          (item) =>
            "content" in item &&
            typeof item.content === "string" &&
            item.content.includes("Background model calls are limited"),
        )
      ) {
        interrupted = true;
        throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
      }
      return apply(input);
    });
    await run(f);
    expect(interrupted).toBe(true);
    const failed = (await listAssignments(f.root)).find(
      (item) => item.taskType === "repository.integration",
    )!;
    expect(failed).toMatchObject({ status: "failed", lease: null });
    const checkout = (await listWorkspaces(f.root)).find(
      (item) => item.assignmentId === failed.assignmentId,
    )!;
    // A failed verification can leave rewritten bytes behind, as a lockfile install does.
    await writeFile(resolve(checkout.ownerWorkspacePath!, "pnpm-lock.yaml"), "rewritten\n");

    await converge(f);
    await run(f);
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
