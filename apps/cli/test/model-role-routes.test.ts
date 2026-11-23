import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MODEL_SELECTION, type ModelSelection } from "@lervo/execution-contract";

const worker = vi.hoisted(() => ({ provider: undefined as "codex" | "claude" | undefined }));
vi.mock("@lervo/repository-knowledge-runtime", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-runtime")>()),
  readWorkerProviderSelection: async () =>
    worker.provider === undefined ? null : { provider: worker.provider },
}));

const {
  modelCallOptions,
  openFirstRoute,
  ProviderRouteStartError,
  readHostSelection,
  reviewCallRoutes,
} = await import("../src/model-role-routes.js");

function selection(roles: ModelSelection["roles"]): ModelSelection {
  return { ...DEFAULT_MODEL_SELECTION, revision: 1, roles };
}

beforeEach(() => {
  worker.provider = undefined;
});

describe("modelCallOptions", () => {
  it("leaves a call unchanged when the role is unset", () => {
    expect(modelCallOptions(DEFAULT_MODEL_SELECTION, "review", "claude")).toEqual({});
    expect(modelCallOptions(DEFAULT_MODEL_SELECTION, "routine", "codex")).toEqual({});
  });

  it("keeps a set role's effort floor for a named provider the role does not list", () => {
    const chosen = selection({
      review: [{ provider: "codex", model: "gpt-x", reasoningEffort: "max" }],
      routine: [{ provider: "codex", model: "gpt-x", reasoningEffort: null }],
    });
    expect(modelCallOptions(chosen, "review", "claude")).toEqual({ reasoningEffort: "high" });
    expect(modelCallOptions(chosen, "routine", "claude")).toEqual({});
  });

  it("passes the route's model and effort, and the role's floor when the route names no effort", () => {
    const chosen = selection({
      review: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: null }],
      routine: [{ provider: "claude", model: null, reasoningEffort: null }],
    });
    expect(modelCallOptions(chosen, "review", "claude")).toEqual({
      model: "claude-opus-5-5",
      reasoningEffort: "high",
    });
    expect(modelCallOptions(chosen, "routine", "claude")).toEqual({});
  });
});

describe("reviewCallRoutes", () => {
  it("keeps a named provider, with the review route for it", async () => {
    const chosen = selection({
      review: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: "max" }],
    });
    await expect(
      reviewCallRoutes({
        repositoryRoot: "/repository",
        provider: "claude",
        selection: chosen,
      }),
    ).resolves.toEqual([{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: "max" }]);
  });

  it("follows the role's order and never adds a provider the role leaves out", async () => {
    worker.provider = "codex";
    const chosen = selection({
      review: [
        { provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" },
        { provider: "claude", model: "claude-sonnet-5-5", reasoningEffort: "high" },
      ],
    });
    await expect(
      reviewCallRoutes({ repositoryRoot: "/repository", selection: chosen }),
    ).resolves.toEqual([{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" }]);
  });

  it("uses the provider the resident last admitted when the role is unset, as before", async () => {
    worker.provider = "claude";
    await expect(
      reviewCallRoutes({
        repositoryRoot: "/repository",
        selection: DEFAULT_MODEL_SELECTION,
      }),
    ).resolves.toEqual([{ provider: "claude" }]);
    worker.provider = undefined;
    await expect(
      reviewCallRoutes({
        repositoryRoot: "/repository",
        selection: DEFAULT_MODEL_SELECTION,
      }),
    ).resolves.toEqual([]);
  });
});

describe("openFirstRoute", () => {
  it("falls through a route that cannot start, and reports a start failure when none can", async () => {
    const open = vi.fn(async (route: { provider: string }) => {
      if (route.provider === "codex") throw new Error("codex is not installed");
      return `session:${route.provider}`;
    });
    await expect(
      openFirstRoute([{ provider: "codex" }, { provider: "claude", model: "m" }], open),
    ).resolves.toEqual({ route: { provider: "claude", model: "m" }, opened: "session:claude" });
    const failure = await openFirstRoute([{ provider: "codex" }], open).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ProviderRouteStartError);
    expect((failure as Error).cause).toMatchObject({ message: "codex is not installed" });
  });
});

it("reads an unusable state directory as the default selection", async () => {
  const previous = process.env.LERVO_USER_STATE_DIRECTORY;
  process.env.LERVO_USER_STATE_DIRECTORY = "relative/state";
  try {
    await expect(readHostSelection()).resolves.toEqual(DEFAULT_MODEL_SELECTION);
  } finally {
    process.env.LERVO_USER_STATE_DIRECTORY = previous;
  }
});
