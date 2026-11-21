import { beforeEach, expect, it, vi } from "vitest";

const answers: unknown[] = [];

vi.mock("@lervo/repository-knowledge-compiler", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: async () => ({ resolve: async () => answers.shift() }),
}));
vi.mock("@lervo/repository-knowledge-runtime", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-runtime")>()),
  prepareLifecyclePlanCrossCheck: async () => ({
    planHash: `sha256:${"1".repeat(64)}`,
    systemPrompt: "Review.",
    request: {},
  }),
}));

const { crossCheckPlan } = await import("../src/plan-cross-check.js");

beforeEach(() => {
  answers.length = 0;
});

const input = { repositoryRoot: "/repository", provider: "codex" as const, plan: {}, paths: [] };
const rationale =
  "The plan drops a section of the source document without carrying its requirement to any other document.";

it("reads a well-formed rejection as a disagreement", async () => {
  answers.push({ decision: "reject", rationale });
  await expect(crossCheckPlan(input)).resolves.toMatchObject({ verdict: "disagree", rationale });
});

it("never reads a malformed answer as a disagreement (ADR-0604)", async () => {
  // The reviewer no longer echoes the plan hash; a broken answer is no verdict at all.
  answers.push({ decision: "aprove", rationale });
  await expect(crossCheckPlan(input)).rejects.toMatchObject({
    code: "knowledge_cross_check_unavailable",
  });
});
