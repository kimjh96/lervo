import { beforeEach, expect, it, vi } from "vitest";

import type { VerifiedCapabilityPackage } from "@lervo/capabilities";
import { DEFAULT_MODEL_SELECTION } from "@lervo/execution-contract";

import {
  crossCheckCapability,
  strongerCapabilityCrossCheck,
} from "../src/capability-install-cross-check.js";
import { ProviderRouteStartError } from "../src/model-role-routes.js";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), requests: [] as unknown[] }));
vi.mock("@lervo/repository-knowledge-compiler", () => ({
  createNoCapabilityProviderJsonRunner: async () => ({
    resolve: async (request: unknown) => {
      mocks.requests.push(request);
      return mocks.resolve(request);
    },
  }),
}));

const rationale =
  "Every file does what the manifest summary and intents say, and nothing reaches an undeclared host.";
const verified = {
  manifest: { capabilityId: "tools/local-mcp", version: "1.0.0" },
  files: [{ path: "server.mjs", bytes: new TextEncoder().encode("process.stdin.resume();\n") }],
} as unknown as VerifiedCapabilityPackage;
const check = (provider: "codex" | "claude" = "codex") =>
  crossCheckCapability({ repositoryRoot: "/repo", package: verified, provider });

beforeEach(() => {
  mocks.resolve.mockReset();
  mocks.requests.length = 0;
});

it("asks for a decision and a rationale only, never a package hash to echo (ADR-0604)", async () => {
  mocks.resolve.mockResolvedValueOnce({ decision: "approve", rationale });
  expect(await check()).toMatchObject({ verdict: "agree", rationale });
  const request = mocks.requests[0] as {
    responseContract: { schema: { properties: object; required: string[] } };
    untrustedSourceData: object;
  };
  expect(Object.keys(request.responseContract.schema.properties)).toEqual([
    "decision",
    "rationale",
  ]);
  expect(request.untrustedSourceData).not.toHaveProperty("packageHash");
  mocks.resolve.mockResolvedValueOnce({ decision: "reject", rationale });
  expect(await check()).toMatchObject({ verdict: "disagree" });
});

it("reports a malformed answer as unavailable, never as a disagreement", async () => {
  for (const answer of [
    { packageHash: `sha256:${"a".repeat(64)}`, decision: "approve", rationale },
    { decision: "maybe", rationale },
    { decision: "reject", rationale: "Too short." },
    { decision: "approve" },
    null,
  ]) {
    mocks.resolve.mockResolvedValueOnce(answer);
    await expect(check()).rejects.toMatchObject({ code: "capability_cross_check_unavailable" });
  }
  // The stronger check stops as unavailable; it never holds the package as disagreed.
  mocks.resolve.mockResolvedValue({ decision: "approve", rationale: "garbled" });
  await expect(
    strongerCapabilityCrossCheck({
      repositoryRoot: "/repo",
      package: verified,
      provider: "codex",
      crossCheck: crossCheckCapability,
    }),
  ).rejects.toMatchObject({ code: "capability_cross_check_unavailable" });
});

it("takes both sessions from the review role and never tries a provider it leaves out (ADR-0612)", async () => {
  const sessions: Array<"codex" | "claude"> = [];
  const result = await strongerCapabilityCrossCheck({
    repositoryRoot: "/repo",
    package: verified,
    crossCheck: async (input) => {
      sessions.push(input.provider);
      return { verdict: "agree", rationale, reviewer: "fixture", provider: input.provider };
    },
    readSelection: async () => ({
      ...DEFAULT_MODEL_SELECTION,
      revision: 1,
      roles: { review: [{ provider: "claude", model: null, reasoningEffort: "high" }] },
    }),
  });
  expect(result.agreed).toBe(true);
  expect(sessions).toEqual(["claude", "claude"]);
});

it("keeps a different second provider from the role when the caller names the first", async () => {
  const sessions: Array<"codex" | "claude"> = [];
  await strongerCapabilityCrossCheck({
    repositoryRoot: "/repo",
    package: verified,
    provider: "codex",
    crossCheck: async (input) => {
      sessions.push(input.provider);
      return { verdict: "agree", rationale, reviewer: "fixture", provider: input.provider };
    },
    readSelection: async () => ({
      ...DEFAULT_MODEL_SELECTION,
      revision: 1,
      roles: {
        review: [
          { provider: "codex", model: null, reasoningEffort: "high" },
          { provider: "claude", model: null, reasoningEffort: "high" },
        ],
      },
    }),
  });
  expect(sessions).toEqual(["codex", "claude"]);
});

it("passes over a listed provider whose CLI cannot start", async () => {
  const sessions: Array<"codex" | "claude"> = [];
  const result = await strongerCapabilityCrossCheck({
    repositoryRoot: "/repo",
    package: verified,
    crossCheck: async (input) => {
      if (input.provider === "codex")
        throw new ProviderRouteStartError("codex", { cause: new Error("not installed") });
      sessions.push(input.provider);
      return { verdict: "agree", rationale, reviewer: "fixture", provider: input.provider };
    },
    readSelection: async () => ({
      ...DEFAULT_MODEL_SELECTION,
      revision: 1,
      roles: {
        review: [
          { provider: "codex", model: null, reasoningEffort: "high" },
          { provider: "claude", model: null, reasoningEffort: "high" },
        ],
      },
    }),
  });
  // The second session would be codex, which cannot start, so claude stands in again.
  expect(result.agreed).toBe(true);
  expect(sessions).toEqual(["claude", "claude"]);
});
