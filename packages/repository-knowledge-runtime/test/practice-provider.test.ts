import { beforeEach, describe, expect, it, vi } from "vitest";
import { callPracticeProvider } from "../src/practice-provider.js";
import { preparePracticeProvider } from "../src/practice-provider-preparation.js";
import { withPracticeProviderAssignment } from "../src/practice-provider-assignment.js";
import type { ConvergenceAssignmentAuthority } from "../src/workforce.js";
import { practiceContext } from "./practice-fixture.js";
import { assessInstructionCapture } from "../src/instruction-capture-assessment.js";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  reserve: vi.fn(),
  release: vi.fn(),
  cleanup: vi.fn(),
  create: vi.fn(),
  complete: vi.fn(),
  admitted: true,
}));
vi.mock("@lervo/repository-knowledge-compiler", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: async () => ({ resolveObserved: mocks.resolve }),
}));
vi.mock("@lervo/agent-workforce", async (load) => ({
  ...(await load<typeof import("@lervo/agent-workforce")>()),
  createPinnedAssignment: mocks.create,
  completeAssignment: mocks.complete,
}));
vi.mock("../src/provider-admission.js", () => ({
  acquireKnowledgeProviderAdmission: async () =>
    mocks.admitted ? { release: mocks.release, observationHash: "observation" } : null,
  pauseKnowledgeProvider: vi.fn(),
}));
vi.mock("../src/practice-budget.js", () => ({
  reservePracticeBudget: mocks.reserve,
  settlePracticeBudget: vi.fn(),
  releaseUnattemptedPracticeBudget: mocks.cleanup,
}));
vi.mock("../src/provider-budget.js", () => ({ reserveConvergenceProviderCall: vi.fn() }));
vi.mock("../src/change-review-host.js", () => ({ knowledgeReviewCallCeiling: async () => 10 }));
vi.mock("@lervo/execution-contract", async (load) => ({
  ...(await load<typeof import("@lervo/execution-contract")>()),
  recordTurnMeasurement: vi.fn(),
}));
const authority = {
  assertCurrent: async () => {},
  assignment: {
    assignmentId: `asg_${"1".repeat(24)}`,
    lease: { sessionId: `ses_${"2".repeat(24)}` },
  },
  agent: { agentId: `agt_${"3".repeat(24)}` },
  delegation: { resourceCeilings: { maximumProviderCalls: 10 } },
} as unknown as ConvergenceAssignmentAuthority;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admitted = true;
  mocks.reserve.mockResolvedValue({ id: "reservation" });
  mocks.resolve.mockResolvedValue({ value: { practice: null }, usage: null });
});
function request(data: unknown) {
  return {
    context: practiceContext("/unused"),
    kind: "assessment" as const,
    key: "work",
    data,
    schema: {},
    prompt: "Assess observed work.",
  };
}
describe("practice provider privacy and preflight", () => {
  it.each(["revoked", "private"])(
    "omits %s practice input from the shared capture call and preserves rule capture",
    async (reason) => {
      const context = practiceContext("/unused");
      const result = await assessInstructionCapture({
        context,
        captureId: `kcap_${"4".repeat(24)}`,
        request: {
          surface: "terminal_prompt",
          ownerTurn: "Preserve user-owned text.",
          precedingAgentTurn: "Completed.",
          precedingWork:
            reason === "private"
              ? { reply: '{"password":"fixture-credential"}' }
              : { reply: "Previously readable work." },
          semanticCatalog: {},
        },
        catalogEntries: [],
        sourceRevision: "revision",
        validatePrecedingWork: async () => reason !== "revoked",
      });
      expect(result.status).toBe("assessed");
      expect(mocks.resolve).toHaveBeenCalledOnce();
      expect(mocks.resolve.mock.calls[0]![0]).toMatchObject({
        untrustedOwnerTurn: "Preserve user-owned text.",
        untrustedPrecedingWork: null,
      });
    },
  );
  it.each(["password", "TOKEN", "secret", "api_key", "Authorization", "cookie", "private_key"])(
    "blocks nested JSON %s before any provider call",
    async (key) => {
      await expect(
        callPracticeProvider({
          ...request({ nested: [{ [key]: "fixture-credential" }] }),
          authority,
        }),
      ).rejects.toThrow("source_incomplete");
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
    },
  );
  it("rechecks JSON text at the call boundary after preparation", async () => {
    const data = { reply: "Public." };
    const input = request(data);
    const prepared = await preparePracticeProvider(input);
    data.reply = '{"password":"fixture-credential"}';
    try {
      await expect(callPracticeProvider({ ...input, authority, prepared })).rejects.toThrow(
        "source_incomplete",
      );
      expect(mocks.resolve).not.toHaveBeenCalled();
    } finally {
      await prepared.release();
    }
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });
  it("rejects structured secrets in a provider response before retention", async () => {
    mocks.resolve.mockResolvedValue({
      value: { reply: '{"password":"fixture-credential"}' },
      usage: null,
    });
    await expect(
      callPracticeProvider({ ...request({ reply: "Public." }), authority }),
    ).rejects.toThrow("Private practice response");
  });
  it("completes a public response with valid usage attribution and holds unknown usage", async () => {
    await expect(
      callPracticeProvider({ ...request({ reply: "Public." }), authority }),
    ).resolves.toEqual({ practice: null });
    expect(mocks.resolve).toHaveBeenCalledOnce();
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("revalidates read authority immediately before invocation", async () => {
    const beforeCall = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("source_incomplete"));
    await expect(
      callPracticeProvider({ ...request({ reply: "Public." }), beforeCall, authority }),
    ).rejects.toThrow("source_incomplete");
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });
  it.each(["budget", "admission"])(
    "never creates a workforce failure while waiting for %s",
    async (wait) => {
      if (wait === "budget") mocks.reserve.mockResolvedValue(null);
      else mocks.admitted = false;
      const original = request({ reply: "Public." });
      const context = {
        ...original.context,
        storage: { ...original.context.storage, writableEventSchemaVersion: 8 as const },
      };
      for (let i = 0; i < 3; i++)
        await expect(
          withPracticeProviderAssignment({
            ...original,
            context,
            role: "generator",
            assignmentKey: "work",
            paths: [],
            resolve: (value) => value,
          }),
        ).rejects.toThrow(
          wait === "budget" ? "practice_budget_exhausted" : "provider_not_admitted",
        );
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
      expect(mocks.resolve).not.toHaveBeenCalled();
    },
  );
});
