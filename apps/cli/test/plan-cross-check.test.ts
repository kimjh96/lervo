import { beforeEach, expect, it, vi } from "vitest";

import { DEFAULT_MODEL_SELECTION } from "@lervo/execution-contract";

const answers: unknown[] = [];
const opened = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const missing = vi.hoisted(() => new Set<string>());

vi.mock("@lervo/repository-knowledge-compiler", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: async (options: Record<string, unknown>) => {
    if (missing.has(options.provider as string)) throw new Error("not installed");
    opened.push(options);
    return { resolve: async () => answers.shift() };
  },
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
  opened.length = 0;
  missing.clear();
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

it("asks the review role's first startable route, with its model and effort (ADR-0612)", async () => {
  missing.add("codex");
  answers.push({ decision: "approve", rationale });
  const verdict = await crossCheckPlan({
    repositoryRoot: "/repository",
    plan: {},
    paths: [],
    readSelection: async () => ({
      ...DEFAULT_MODEL_SELECTION,
      revision: 2,
      roles: {
        review: [
          { provider: "codex", model: null, reasoningEffort: "high" },
          { provider: "claude", model: "claude-opus-5-5", reasoningEffort: null },
        ],
      },
    }),
  });
  expect(verdict).toMatchObject({ verdict: "agree", reviewer: "no-capability claude session" });
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({
    provider: "claude",
    model: "claude-opus-5-5",
    reasoningEffort: "high",
  });
});
