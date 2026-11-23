import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_MODEL_SELECTION, type ModelSelection } from "@lervo/execution-contract";

const worker = vi.hoisted(() => ({ provider: undefined as "codex" | "claude" | undefined }));
vi.mock("@lervo/repository-knowledge-runtime", async (load) => ({
  ...(await load<typeof import("@lervo/repository-knowledge-runtime")>()),
  readWorkerProviderSelection: async () =>
    worker.provider === undefined ? null : { provider: worker.provider },
}));

const { modelCallOptions, openFirstRoute, reviewCallRoutes } =
  await import("../src/model-role-routes.js");

function selection(roles: ModelSelection["roles"]): ModelSelection {
  return { ...DEFAULT_MODEL_SELECTION, revision: 1, roles };
}

beforeEach(() => {
  worker.provider = undefined;
});

describe("modelCallOptions", () => {
  it("leaves a call unchanged when the role has no route for its provider", () => {
    expect(modelCallOptions(DEFAULT_MODEL_SELECTION, "review", "claude")).toEqual({});
    expect(
      modelCallOptions(
        selection({ review: [{ provider: "codex", model: "gpt-x", reasoningEffort: "high" }] }),
        "review",
        "claude",
      ),
    ).toEqual({});
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
  const readSelection = (value: ModelSelection) => async () => value;

  it("keeps a named provider, with the review route for it", async () => {
    const chosen = selection({
      review: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: "max" }],
    });
    await expect(
      reviewCallRoutes({
        repositoryRoot: "/repository",
        provider: "claude",
        readSelection: readSelection(chosen),
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
      reviewCallRoutes({ repositoryRoot: "/repository", readSelection: readSelection(chosen) }),
    ).resolves.toEqual([{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: "high" }]);
  });

  it("uses the provider the resident last admitted when the role is unset, as before", async () => {
    worker.provider = "claude";
    await expect(
      reviewCallRoutes({
        repositoryRoot: "/repository",
        readSelection: readSelection(DEFAULT_MODEL_SELECTION),
      }),
    ).resolves.toEqual([{ provider: "claude" }]);
    worker.provider = undefined;
    await expect(
      reviewCallRoutes({
        repositoryRoot: "/repository",
        readSelection: readSelection(DEFAULT_MODEL_SELECTION),
      }),
    ).resolves.toEqual([]);
  });
});

describe("openFirstRoute", () => {
  it("falls through a route that cannot start, and reports the last failure when none can", async () => {
    const open = vi.fn(async (route: { provider: string }) => {
      if (route.provider === "codex") throw new Error("codex is not installed");
      return `session:${route.provider}`;
    });
    await expect(
      openFirstRoute([{ provider: "codex" }, { provider: "claude", model: "m" }], open),
    ).resolves.toEqual({ route: { provider: "claude", model: "m" }, opened: "session:claude" });
    await expect(openFirstRoute([{ provider: "codex" }], open)).rejects.toThrow(
      "codex is not installed",
    );
  });
});
