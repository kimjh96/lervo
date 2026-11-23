import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_SELECTION,
  writeModelSelectionRole,
  type ModelSelection,
} from "@lervo/execution-contract";
import { hostModelSelectionDirectory } from "@lervo/repository-knowledge-runtime";

import {
  conversationResponseRoute,
  NodeModelRouteError,
  nodeRoleRoute,
  nodeRouteForProvider,
  readHostNodeModelSelection,
} from "../src/node-model-route.js";

const configured = { provider: "codex" as const, model: "configured-model" };
// No provider CLI is installed where tests run; each case states which providers can start.
const startable =
  (...providers: string[]) =>
  (provider: string) =>
    providers.includes(provider);
const both = startable("codex", "claude");
const selection =
  (roles: ModelSelection["roles"]): (() => ModelSelection) =>
  () => ({ ...DEFAULT_MODEL_SELECTION, revision: 1, roles });

describe("nodeRoleRoute", () => {
  it("keeps the configured route while the role is unset", () => {
    expect(nodeRoleRoute({ role: "routine", configured, readSelection: selection({}) })).toEqual({
      ...configured,
      source: "configuration",
    });
  });

  it("uses the first route the caller may use, with the role's default effort", () => {
    const readSelection = selection({
      review: [
        { provider: "codex", model: "gpt-x", reasoningEffort: "max" },
        { provider: "claude", model: "claude-opus-5-5", reasoningEffort: null },
      ],
    });
    expect(nodeRoleRoute({ role: "review", configured, readSelection, startable: both })).toEqual({
      provider: "codex",
      model: "gpt-x",
      reasoningEffort: "max",
      source: "selection",
    });
    expect(
      nodeRoleRoute({
        role: "review",
        configured,
        allowed: ["claude"],
        readSelection,
        startable: both,
      }),
    ).toEqual({
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      source: "selection",
    });
  });

  it("waits when the set role lists no provider the caller may use (ADR-0612)", () => {
    expect(() =>
      nodeRoleRoute({
        role: "routine",
        configured,
        allowed: ["codex"],
        startable: both,
        readSelection: selection({
          routine: [{ provider: "claude", model: null, reasoningEffort: null }],
        }),
      }),
    ).toThrow(NodeModelRouteError);
  });

  it("passes over a listed provider this host cannot start", () => {
    const readSelection = selection({
      routine: [
        { provider: "codex", model: "gpt-x", reasoningEffort: null },
        { provider: "claude", model: "claude-sonnet-5-5", reasoningEffort: null },
      ],
    });
    expect(
      nodeRoleRoute({ role: "routine", configured, readSelection, startable: startable("claude") }),
    ).toMatchObject({ provider: "claude", model: "claude-sonnet-5-5" });
    expect(() =>
      nodeRoleRoute({ role: "routine", configured, readSelection, startable: startable() }),
    ).toThrow(NodeModelRouteError);
  });
});

describe("nodeRouteForProvider", () => {
  it("uses the role's route for a fixed provider, or the configured values", () => {
    const readSelection = selection({
      routine: [{ provider: "claude", model: "claude-sonnet-5-5", reasoningEffort: "medium" }],
    });
    expect(
      nodeRouteForProvider({
        role: "routine",
        provider: "claude",
        configured: { model: "old" },
        readSelection,
      }),
    ).toEqual({ model: "claude-sonnet-5-5", reasoningEffort: "medium" });
    expect(
      nodeRouteForProvider({
        role: "routine",
        provider: "codex",
        configured: { model: "old", reasoningEffort: "low" },
        readSelection,
      }),
    ).toEqual({ model: "old", reasoningEffort: "low" });
  });
});

describe("the host selection read at each call", () => {
  let directory: string;
  let previous: string | undefined;

  beforeEach(async () => {
    previous = process.env.LERVO_USER_STATE_DIRECTORY;
    directory = await mkdtemp(resolve(tmpdir(), "lervo-node-model-route-"));
    process.env.LERVO_USER_STATE_DIRECTORY = directory;
  });

  afterEach(async () => {
    process.env.LERVO_USER_STATE_DIRECTORY = previous;
    await rm(directory, { recursive: true, force: true });
  });

  it("changes the next call's route in the same process, with no restart", async () => {
    expect(nodeRoleRoute({ role: "routine", configured, startable: both }).source).toBe(
      "configuration",
    );
    await writeModelSelectionRole({
      stateDirectory: hostModelSelectionDirectory(),
      role: "routine",
      routes: [{ provider: "claude", model: "claude-sonnet-5-5", reasoningEffort: null }],
    });
    expect(nodeRoleRoute({ role: "routine", configured, startable: both })).toEqual({
      provider: "claude",
      model: "claude-sonnet-5-5",
      source: "selection",
    });
    await writeModelSelectionRole({
      stateDirectory: hostModelSelectionDirectory(),
      role: "routine",
      routes: [{ provider: "codex", model: "gpt-y", reasoningEffort: "low" }],
    });
    expect(nodeRoleRoute({ role: "routine", configured, startable: both })).toMatchObject({
      provider: "codex",
      model: "gpt-y",
    });
  });

  it("reads an unusable state directory as the defaults", () => {
    process.env.LERVO_USER_STATE_DIRECTORY = "relative/state";
    expect(readHostNodeModelSelection()).toEqual(DEFAULT_MODEL_SELECTION);
  });
});

describe("conversationResponseRoute", () => {
  const response = { provider: "codex" as const, model: "reply-model", timeoutMs: 90_000 };
  const profiles = {
    reasoning: {
      preferredProvider: "codex" as const,
      providers: {
        codex: { model: "deep-model", reasoningEffort: "xhigh" as const, timeoutMs: 600_000 },
        claude: { reasoningEffort: "high" as const, timeoutMs: 300_000 },
      },
    },
  };

  it("keeps the configured profile route, and its timeout, while the role is unset", () => {
    expect(
      conversationResponseRoute({
        response,
        executionProfile: "reasoning",
        profiles,
        readSelection: selection({}),
      }),
    ).toEqual({
      provider: "codex",
      model: "deep-model",
      reasoningEffort: "xhigh",
      timeoutMs: 600_000,
      source: "configuration",
    });
  });

  it("takes the profile's role from the selection, inside the agent's provider policy", () => {
    const readSelection = selection({
      reasoning: [
        { provider: "codex", model: "gpt-x", reasoningEffort: "max" },
        { provider: "claude", model: "claude-opus-5-5", reasoningEffort: null },
      ],
    });
    expect(
      conversationResponseRoute({
        response,
        executionProfile: "reasoning",
        profiles,
        providerPolicy: "claude",
        readSelection,
        startable: both,
      }),
    ).toEqual({
      provider: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      timeoutMs: 300_000,
      source: "selection",
    });
    // A plain reply is the routine role, which is unset here.
    expect(conversationResponseRoute({ response, readSelection, startable: both })).toMatchObject({
      provider: "codex",
      model: "reply-model",
      timeoutMs: 90_000,
    });
  });
});

it("keeps the profile's timeout for a selected provider the profile does not configure", () => {
  expect(
    conversationResponseRoute({
      response: { provider: "codex", timeoutMs: 60_000 },
      executionProfile: "reasoning",
      profiles: {
        reasoning: {
          preferredProvider: "codex",
          providers: { codex: { reasoningEffort: "xhigh", timeoutMs: 600_000 } },
        },
      },
      readSelection: selection({
        reasoning: [{ provider: "claude", model: null, reasoningEffort: null }],
      }),
      startable: both,
    }),
  ).toMatchObject({ provider: "claude", reasoningEffort: "high", timeoutMs: 600_000 });
});
