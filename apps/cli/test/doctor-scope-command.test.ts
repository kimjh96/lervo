import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { DoctorInspection, DoctorScope } from "@lervo/diagnostics";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const temporaryRoots: string[] = [];
const healthyEnvironmentInspections: DoctorInspection[] = [
  "document_registry",
  "document_sources",
  "skill_packages",
  "skill_lock",
  "provider_codex_runtime",
  "provider_claude_runtime",
  "search_engine_selection",
  "search_rollout_policies",
  "search_rollout_reviews",
  "search_rollout_actions",
].map((checkId) => ({
  check: {
    checkId: checkId as DoctorInspection["check"]["checkId"],
    status: "healthy",
    observedCount: checkId.startsWith("provider_") ? 1 : 0,
  },
  issues: [],
}));

async function initializedRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-doctor-scope-"));
  temporaryRoots.push(root);
  expect(
    await runCli(["init"], {
      cwd: root,
      stdout: () => undefined,
      stderr: () => undefined,
    }),
  ).toBe(0);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("lervo doctor limited scopes", () => {
  it.each([
    ["documents", "documents", ["document_registry", "document_sources"]],
    ["skills", "skills", ["skill_packages", "skill_lock"]],
    ["providers", "agent runtimes", ["provider_codex_runtime", "provider_claude_runtime"]],
    [
      "search",
      "search",
      [
        "search_engine_selection",
        "search_rollout_policies",
        "search_rollout_reviews",
        "search_rollout_actions",
      ],
    ],
  ] as const)("runs only the %s environment inspectors", async (scope, label, expectedCheckIds) => {
    const root = await initializedRepository();
    const observedScopes: DoctorScope[] = [];
    const expected = new Set<string>(expectedCheckIds);
    const inspections = healthyEnvironmentInspections.filter((inspection) =>
      expected.has(inspection.check.checkId),
    );
    const services = {
      openProjectStorage: async () => {
        throw new Error("Project storage must not be opened in the restricted scope.");
      },
      inspectDoctorEnvironment: async (input: { scope?: DoctorScope }) => {
        observedScopes.push(input.scope ?? "all");
        return inspections;
      },
    };
    let textOutput = "";

    expect(
      await runCli(
        ["doctor", "--scope", scope],
        {
          cwd: root,
          stdout: (message) => {
            textOutput += message;
          },
          stderr: () => undefined,
        },
        services,
      ),
    ).toBe(0);
    expect(textOutput).toContain(`Lervo ${label} diagnostic report: checked items are healthy`);
    expect(textOutput).toContain(
      `only ${label} items were checked; this is not the overall project status`,
    );

    let jsonOutput = "";
    expect(
      await runCli(
        ["doctor", "--scope", scope, "--json"],
        {
          cwd: root,
          stdout: (message) => {
            jsonOutput += message;
          },
          stderr: () => undefined,
        },
        services,
      ),
    ).toBe(0);
    const report = JSON.parse(jsonOutput) as {
      scope: DoctorScope;
      status: string;
      checks: Array<{ checkId: string }>;
    };
    expect(report).toMatchObject({ scope, status: "healthy" });
    expect(report.checks.map((check) => check.checkId)).toEqual(expectedCheckIds);
    expect(observedScopes).toEqual([scope, scope]);
  });

  it("runs knowledge diagnostics without calling environment inspectors", async () => {
    const root = await initializedRepository();
    let environmentCalls = 0;
    let textOutput = "";

    expect(
      await runCli(
        ["doctor", "--scope", "knowledge"],
        {
          cwd: root,
          stdout: (message) => {
            textOutput += message;
          },
          stderr: () => undefined,
        },
        {
          inspectDoctorEnvironment: async () => {
            environmentCalls += 1;
            throw new Error("The environment inspector must not be called in the knowledge scope.");
          },
        },
      ),
    ).toBe(0);
    expect(environmentCalls).toBe(0);
    expect(textOutput).toContain("Lervo knowledge diagnostic report: checked items are healthy");
    expect(textOutput).toContain(
      "only knowledge items were checked; this is not the overall project status",
    );
    expect(textOutput).not.toContain("document registry");

    let jsonOutput = "";
    expect(
      await runCli(
        ["doctor", "--scope", "knowledge", "--json"],
        {
          cwd: root,
          stdout: (message) => {
            jsonOutput += message;
          },
          stderr: () => undefined,
        },
        {
          inspectDoctorEnvironment: async () => {
            environmentCalls += 1;
            throw new Error("The environment inspector must not be called in the knowledge scope.");
          },
        },
      ),
    ).toBe(0);
    const report = JSON.parse(jsonOutput) as {
      scope: DoctorScope;
      checks: Array<{ checkId: string }>;
    };
    expect(report.scope).toBe("knowledge");
    expect(report.checks.map((check) => check.checkId)).toEqual(["event_chain"]);
    expect(environmentCalls).toBe(0);
  });

  it("uses only the selected scope when deciding the exit code", async () => {
    const root = await initializedRepository();
    const inspections = structuredClone(
      healthyEnvironmentInspections.filter((inspection) =>
        inspection.check.checkId.startsWith("provider_"),
      ),
    );
    const codex = inspections.find(
      (inspection) => inspection.check.checkId === "provider_codex_runtime",
    )!;
    codex.check.status = "unknown";
    codex.check.observedCount = 0;
    codex.issues.push({
      code: "provider_executable_missing",
      eventId: null,
      message: "The Codex executable was not found.",
    });
    let output = "";

    expect(
      await runCli(
        ["doctor", "--scope", "providers", "--json"],
        {
          cwd: root,
          stdout: (message) => {
            output += message;
          },
          stderr: () => undefined,
        },
        {
          openProjectStorage: async () => {
            throw new Error("Project storage must not be opened in the provider scope.");
          },
          inspectDoctorEnvironment: async () => inspections,
        },
      ),
    ).toBe(1);
    expect(JSON.parse(output)).toMatchObject({
      scope: "providers",
      status: "unknown",
      recoveryGuidance: [
        {
          issueCode: "provider_executable_missing",
          actionCode: "check_provider_executable",
          actionState: "not_performed",
        },
      ],
    });
  });

  it("rejects an unknown scope before opening project storage", async () => {
    let opened = false;
    let errorOutput = "";

    expect(
      await runCli(
        ["doctor", "--scope", "network"],
        {
          cwd: "/unused",
          stdout: () => undefined,
          stderr: (message) => {
            errorOutput += message;
          },
        },
        {
          openProjectStorage: async () => {
            opened = true;
            throw new Error("must not open");
          },
        },
      ),
    ).toBe(1);
    expect(opened).toBe(false);
    expect(errorOutput).toContain("Unsupported doctor scope: network");
    expect(errorOutput).toContain("--scope <all|knowledge|documents|skills|providers|search>");
  });
});
