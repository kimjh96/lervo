import { describe, expect, it } from "vitest";
import type { AgentWorkspace, WorkforceAssignment } from "@lervo/agent-workforce";
import { convergenceWorkspaceRetirement } from "../src/workspace-retention.js";

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
