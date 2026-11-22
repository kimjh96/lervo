import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_SELECTION,
  modelRouteFor,
  modelSelectionPath,
  readModelSelection,
  resolveModelRoute,
  validateModelRoute,
  writeModelSelectionRole,
} from "../src/model-selection.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-model-selection-"));
  roots.push(root);
  return resolve(root, "state");
}

describe("model selection (ADR-0612)", () => {
  it("defaults every role to the provider defaults, with low effort for background work", async () => {
    const state = await directory();
    expect(await readModelSelection(state)).toEqual({
      selection: DEFAULT_MODEL_SELECTION,
      issue: null,
    });
    expect(modelRouteFor(DEFAULT_MODEL_SELECTION, "background", "claude")).toEqual({
      model: null,
      reasoningEffort: "low",
    });
    expect(modelRouteFor(DEFAULT_MODEL_SELECTION, "reasoning", "claude")).toEqual({
      model: null,
      reasoningEffort: "high",
    });
    expect(modelRouteFor(DEFAULT_MODEL_SELECTION, "routine", "claude")).toEqual({
      model: null,
      reasoningEffort: null,
    });
    expect(
      await resolveModelRoute({ selection: DEFAULT_MODEL_SELECTION, role: "routine" }),
    ).toEqual({ route: null, skipped: [], defaulted: true });
  });

  it("writes one role as the next revision, owner-only, and reads a change at once", async () => {
    const state = await directory();
    const first = await writeModelSelectionRole({
      stateDirectory: state,
      role: "background",
      routes: [{ provider: "claude", model: "claude-haiku-5-5", reasoningEffort: "medium" }],
      now: new Date("2026-11-22T13:00:00Z"),
    });
    expect(first).toMatchObject({ revision: 1, changedAt: "2026-11-22T13:00:00.000Z" });
    expect((await stat(modelSelectionPath(state))).mode & 0o777).toBe(0o600);
    expect(
      modelRouteFor((await readModelSelection(state)).selection, "background", "claude"),
    ).toEqual({
      model: "claude-haiku-5-5",
      reasoningEffort: "medium",
    });
    // A running process sees the next write without restarting.
    await writeModelSelectionRole({
      stateDirectory: state,
      role: "background",
      routes: [{ provider: "claude", model: "claude-opus-5-5", reasoningEffort: null }],
    });
    const read = await readModelSelection(state);
    expect(read.selection.revision).toBe(2);
    expect(modelRouteFor(read.selection, "background", "claude")).toEqual({
      model: "claude-opus-5-5",
      reasoningEffort: "low",
    });
    const unset = await writeModelSelectionRole({
      stateDirectory: state,
      role: "background",
      routes: [],
    });
    expect(unset).toMatchObject({ revision: 3, roles: {} });
  });

  it("falls through routes the caller may not use or that cannot run here", async () => {
    const state = await directory();
    const selection = await writeModelSelectionRole({
      stateDirectory: state,
      role: "review",
      routes: [
        { provider: "codex", model: "gpt-6-sol", reasoningEffort: "high" },
        { provider: "claude", model: null, reasoningEffort: "high" },
      ],
    });
    expect(
      await resolveModelRoute({
        selection,
        role: "review",
        available: (provider) => provider === "claude",
      }),
    ).toEqual({
      route: { provider: "claude", model: null, reasoningEffort: "high" },
      skipped: [
        {
          route: { provider: "codex", model: "gpt-6-sol", reasoningEffort: "high" },
          reason: "provider_unavailable",
        },
      ],
      defaulted: false,
    });
    expect(
      await resolveModelRoute({
        selection,
        role: "review",
        allowed: ["codex"],
        available: () => false,
      }),
    ).toMatchObject({
      route: null,
      defaulted: false,
      skipped: [{ reason: "provider_unavailable" }, { reason: "provider_not_allowed" }],
    });
  });

  it("keeps the quality floor of reasoning and review and refuses malformed routes", () => {
    expect(() =>
      validateModelRoute("review", { provider: "claude", model: null, reasoningEffort: "low" }),
    ).toThrow(/needs reasoning effort high/u);
    expect(() =>
      validateModelRoute("routine", { provider: "gemini", model: null, reasoningEffort: null }),
    ).toThrow(/provider is one of/u);
    expect(() =>
      validateModelRoute("routine", {
        provider: "claude",
        model: "bad model",
        reasoningEffort: null,
      }),
    ).toThrow(/plain model id/u);
  });

  it("treats a damaged file as the provider defaults and names the issue", async () => {
    const state = await directory();
    await writeModelSelectionRole({
      stateDirectory: state,
      role: "routine",
      routes: [{ provider: "claude", model: null, reasoningEffort: null }],
    });
    await writeFile(modelSelectionPath(state), "{ not json");
    expect(await readModelSelection(state)).toEqual({
      selection: DEFAULT_MODEL_SELECTION,
      issue: "model_selection_invalid",
    });
    expect(await readFile(modelSelectionPath(state), "utf8")).toBe("{ not json");
    // A damaged record is never silently replaced.
    await expect(
      writeModelSelectionRole({
        stateDirectory: state,
        role: "routine",
        routes: [{ provider: "claude", model: null, reasoningEffort: null }],
      }),
    ).rejects.toMatchObject({ code: "model_selection_invalid" });
    expect(await readFile(modelSelectionPath(state), "utf8")).toBe("{ not json");
  });

  it("keeps roles a newer Lervo wrote when it changes another one", async () => {
    const state = await directory();
    await writeModelSelectionRole({
      stateDirectory: state,
      role: "routine",
      routes: [{ provider: "claude", model: null, reasoningEffort: null }],
    });
    const file = JSON.parse(await readFile(modelSelectionPath(state), "utf8"));
    file.roles.planning = [{ provider: "claude", model: "future", reasoningEffort: "high" }];
    await writeFile(modelSelectionPath(state), JSON.stringify(file), { mode: 0o600 });
    const read = await readModelSelection(state);
    expect(read.issue).toBeNull();
    expect(read.selection.roles).not.toHaveProperty("planning");
    await writeModelSelectionRole({
      stateDirectory: state,
      role: "background",
      routes: [{ provider: "claude", model: null, reasoningEffort: "low" }],
    });
    const after = JSON.parse(await readFile(modelSelectionPath(state), "utf8"));
    expect(after.revision).toBe(2);
    expect(after.roles.planning).toEqual(file.roles.planning);
    expect(after.roles.routine).toEqual(file.roles.routine);
  });
});
