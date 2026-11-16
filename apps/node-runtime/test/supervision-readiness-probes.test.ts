import { execFile } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { claimAssignment } from "@lervo/agent-workforce";
import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { openReadOnlyProjectStorage } from "@lervo/project-storage";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  structuralManifestPath,
} from "@lervo/repository-knowledge";
import { verificationSuiteHash } from "@lervo/verification";
import { operatingContractHash, projectOutcomeSupervision } from "@lervo/work-controller";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  readNodeDispatchPreflight,
  readNodeDispatchReadiness,
} from "../src/supervision-dispatch-readiness.js";
import {
  inspectSupervisionKnowledgeReadiness,
  observeSupervisionKnowledgeReadiness,
} from "../src/supervision-knowledge-readiness.js";
import { observeSupervisionLoginReadiness } from "../src/supervision-login-readiness.js";
import { observeSupervisionRepositoryReadiness } from "../src/supervision-repository-readiness.js";
import { observeSupervisionRuntimeReadiness } from "../src/supervision-runtime-readiness.js";
import {
  snapshotRuntimeReadinessConfiguration,
  type NodeRuntimeReadinessConfiguration,
} from "../src/supervision-runtime-configuration.js";
import { NodeSupervisionStore } from "../src/supervision-store.js";
import { observeSupervisionVerificationReadiness } from "../src/supervision-verification-readiness.js";
import * as workspaceSource from "../src/supervision-workspace-source.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

// Every probe below reads one real dispatch fixture: a Git repository with an installed mandate,
// a claimed assignment, a provisioned worker worktree, a knowledge migration and a login fixture.
// Rows that change repository bytes restore them, or work on a copy, so later rows observe the
// same healthy fixture. The row that re-claims the assignment cannot be undone and runs last.
const roots: string[] = [];
const execute = promisify(execFile);
let f: Awaited<ReturnType<typeof dispatchFixture>>;
let plan: OperatingActionPlanV1;
type Readiness = Awaited<ReturnType<typeof f.ports.readWorkerReadiness>>;
type Kind = Readiness["observation"]["checks"][number]["kind"];
type Expected =
  | "rehashed"
  | "permission_failed"
  | { status: "failed" | "unobserved" | "not_required"; evidenceHash: null };

beforeAll(async () => {
  f = await dispatchFixture(roots);
  plan = (await f.ports.propose(
    projectOutcomeSupervision({
      snapshot: f.observation,
      now: f.ports.now(),
      maximumRecoveryDecisions: 1,
    }),
  ))!;
}, 60_000);
afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const readiness = () => f.ports.readWorkerReadiness(plan);
const configuration = () => structuredClone(f.runtimeReadiness);
const checkOf = (value: Readiness, kind: Kind) =>
  value.observation.checks.find((check) => check.kind === kind)!;
const unobserved = { status: "unobserved", evidenceHash: null } as const;

/** Pins every check: listed kinds change as stated, every other check and field is untouched. */
function expectChecks(
  result: Readiness,
  input: Readiness,
  changed: Partial<Record<Kind, Expected>>,
  validUntil = input.observation.validUntil,
) {
  expect(result.responsibility).toEqual(input.responsibility);
  expect(result.requiredChecks).toEqual(input.requiredChecks);
  expect({ ...result.observation, checks: [] }).toEqual({
    ...input.observation,
    validUntil,
    checks: [],
  });
  expect(result.observation.checks.map((check) => check.kind)).toEqual(
    input.observation.checks.map((check) => check.kind),
  );
  for (const check of result.observation.checks) {
    const before = checkOf(input, check.kind);
    const expected = changed[check.kind];
    if (expected === undefined) expect(check).toEqual(before);
    else if (expected === "rehashed" || expected === "permission_failed") {
      expect(check.status).toBe(expected === "rehashed" ? "passed" : "failed");
      expect(check.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(check.evidenceHash).not.toBe(before.evidenceHash);
    } else expect(check).toEqual({ kind: check.kind, ...expected });
  }
}

async function deniedWrapper(subject: string, target: string) {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-readiness-permission-"));
  roots.push(directory);
  const executable = resolve(directory, subject);
  await writeFile(executable, `#!/bin/sh\nexec "${target}" "$@"\n`, { mode: 0o000 });
  return { directory, executable };
}

describe("verification definitions", () => {
  const suitePath = () => resolve(f.root, `.lervo/verifications/${f.suites[0]!.suiteId}.yaml`);
  afterEach(async () => {
    await rm(suitePath(), { force: true });
    await writeFile(suitePath(), JSON.stringify(f.suites[0]!));
    await rm(resolve(f.root, "suite.yaml"), { force: true });
    await rm(resolve(f.root, "must-not-run"), { force: true });
  });

  it("observes exact definitions without running commands or refreshing application evidence", async () => {
    const suite = structuredClone(f.suites[0]!);
    suite.commands[0]!.arguments = [
      "-e",
      "require('node:fs').writeFileSync('must-not-run', 'ran')",
    ];
    await writeFile(suitePath(), JSON.stringify(suite));
    const pinned = configuration();
    pinned.verificationSuiteHashes[suite.suiteId] = verificationSuiteHash(suite);
    const input = await readiness();
    const result = await observeSupervisionVerificationReadiness({
      repositoryRoot: f.root,
      configuration: pinned,
      readiness: input,
      now: f.ports.now,
    });
    expectChecks(result, input, { verification: "rehashed" });
    expect(result.observation.observedAt).toBe(input.observation.observedAt);
    expect(JSON.stringify(result)).not.toContain("must-not-run");
    await expect(access(resolve(f.root, "must-not-run"))).rejects.toThrow();
  });

  it.each(["pin", "missing", "changed", "invalid", "symlink", "cwd", "time"])(
    "rejects %s definitions",
    async (change) => {
      const suite = structuredClone(f.suites[0]!);
      const path = suitePath();
      const pinned = configuration();
      let now = f.ports.now;
      if (change === "pin") pinned.verificationSuiteHashes = {};
      if (change === "missing") await rm(path);
      if (change === "invalid") await writeFile(path, "invalid: true\n");
      if (change === "changed") {
        suite.commands[0]!.arguments = ["--help"];
        await writeFile(path, JSON.stringify(suite));
      }
      if (change === "symlink") {
        const outside = resolve(f.root, "suite.yaml");
        await writeFile(outside, JSON.stringify(suite));
        await rm(path);
        await symlink(outside, path);
      }
      if (change === "cwd") {
        suite.commands[0]!.cwd = "absent";
        await writeFile(path, JSON.stringify(suite));
        pinned.verificationSuiteHashes[suite.suiteId] = verificationSuiteHash(suite);
      }
      if (change === "time") {
        let count = 0;
        const time = Date.parse(f.ports.now());
        now = () => new Date(time + (count++ === 0 ? 0 : 5001)).toISOString();
      }
      const input = await readiness();
      const result = await observeSupervisionVerificationReadiness({
        repositoryRoot: f.root,
        configuration: pinned,
        readiness: input,
        now,
      });
      expectChecks(result, input, { verification: unobserved });
    },
  );

  it.each(["failed", "unobserved", "not_required"] as const)(
    "preserves %s application verification evidence",
    async (status) => {
      const input = await readiness();
      checkOf(input, "verification").status = status;
      expect(
        await observeSupervisionVerificationReadiness({
          repositoryRoot: f.root,
          configuration: configuration(),
          readiness: input,
          now: f.ports.now,
        }),
      ).toEqual(input);
    },
  );
});

describe("provider login observation", () => {
  afterEach(async () => {
    await writeFile(f.login.statePath, "present");
  });
  const observe = async (input: Readiness, value = configuration()) =>
    observeSupervisionLoginReadiness({
      plan,
      readiness: input,
      configuration: value,
      now: f.ports.now,
    });

  it("supplements an observed login without refreshing application evidence", async () => {
    const input = await readiness();
    expectChecks(await observe(input), input, { provider: "rehashed" });
  });

  it.each(["absent", "malformed", "context", "configuration"])(
    "does not accept a %s login observation",
    async (state) => {
      const value: NodeRuntimeReadinessConfiguration = configuration();
      if (state === "context") value.providerLoginContexts = {};
      if (state === "absent" || state === "malformed") await writeFile(f.login.statePath, state);
      const input = await readiness();
      const result = await observeSupervisionLoginReadiness({
        plan,
        readiness: input,
        configuration: state === "configuration" ? undefined : value,
        now: f.ports.now,
      });
      expectChecks(result, input, { provider: unobserved });
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "records a permission-denied login probe as an observed failure",
    async () => {
      const denied = await deniedWrapper("provider", f.login.executable);
      const value = configuration();
      value.providerExecutables.codex = denied.executable;
      const input = await readiness();
      const result = await observe(input, value);
      expectChecks(result, input, { provider: "permission_failed" });
      expect(JSON.stringify(result)).not.toContain(denied.directory);
    },
  );
});

describe("runtime executable observation", () => {
  const observe = async (input: Readiness, value = configuration()) =>
    observeSupervisionRuntimeReadiness({
      plan,
      readiness: input,
      configuration: value,
      now: f.ports.now,
    });

  it("supplements observed provider and tool executables", async () => {
    const input = await readiness();
    expectChecks(await observe(input), input, { provider: "rehashed", tools: "rehashed" });
  });

  it.each(["configuration", "provider", "tool", "suite"])(
    "does not observe dispatch without an observed %s",
    async (missing) => {
      const value = configuration();
      if (missing === "provider") value.providerExecutables.codex = "/missing/lervo-provider";
      if (missing === "tool")
        Object.values(value.verificationTools)[0]![0]!.executable = "/missing/lervo-tool";
      if (missing === "suite") value.verificationTools = {};
      const input = await readiness();
      const result = await observeSupervisionRuntimeReadiness({
        plan,
        readiness: input,
        configuration: missing === "configuration" ? undefined : value,
        now: f.ports.now,
      });
      expectChecks(result, input, {
        provider: missing === "configuration" || missing === "provider" ? unobserved : "rehashed",
        tools: missing === "provider" ? "rehashed" : unobserved,
      });
    },
  );

  it.each(["failed", "unobserved"] as const)(
    "never promotes %s auth evidence after a successful version probe",
    async (status) => {
      const input = await readiness();
      checkOf(input, "provider").status = status;
      // The final readiness composition runs the login probe before the runtime probe.
      const result = await observe(
        await observeSupervisionLoginReadiness({
          plan,
          readiness: input,
          configuration: configuration(),
          now: f.ports.now,
        }),
      );
      expectChecks(result, input, { tools: "rehashed" });
      expect(checkOf(result, "provider")).toEqual(checkOf(input, "provider"));
    },
  );

  it
    .skipIf(process.platform === "win32" || process.getuid?.() === 0)
    .each(["provider", "tools"] as const)(
    "records a %s permission denial as an observed failure",
    async (subject) => {
      const value = configuration();
      const tool = Object.values(value.verificationTools)[0]![0]!;
      const denied = await deniedWrapper(
        subject,
        subject === "provider" ? value.providerExecutables.codex! : tool.executable,
      );
      if (subject === "provider") value.providerExecutables.codex = denied.executable;
      else tool.executable = denied.executable;
      const input = await readiness();
      const result = await observe(input, value);
      expectChecks(
        result,
        input,
        subject === "provider"
          ? { provider: "permission_failed", tools: "rehashed" }
          : { provider: "rehashed", tools: "permission_failed" },
      );
      expect(JSON.stringify(result)).not.toContain(denied.directory);
    },
  );
});

describe("trusted runtime configuration", () => {
  it("snapshots the configuration so caller mutation cannot change it", () => {
    const original = configuration();
    const snapshot = snapshotRuntimeReadinessConfiguration(original)!;
    original.providerExecutables.codex = "/missing/changed-after-open";
    original.providerLoginContexts!.codex!.configurationDirectory = "/missing/profile";
    Object.values(original.verificationTools)[0]![0]!.executable = "/missing/tool";
    expect(snapshot).toEqual(f.runtimeReadiness);
    expect(snapshotRuntimeReadinessConfiguration(undefined)).toBeUndefined();
  });

  it("rejects relative executables, conflicting tool identities, malformed pins and login extras", () => {
    expect(() =>
      snapshotRuntimeReadinessConfiguration({
        providerExecutables: { codex: "codex" },
        verificationTools: {},
      }),
    ).toThrow(TypeError);
    expect(() =>
      snapshotRuntimeReadinessConfiguration({
        providerExecutables: {},
        verificationTools: {
          first: [{ toolId: "node", executable: process.execPath }],
          second: [{ toolId: "node", executable: "/different/node" }],
        },
      }),
    ).toThrow(TypeError);
    expect(() =>
      snapshotRuntimeReadinessConfiguration({
        providerExecutables: {},
        verificationTools: {},
        verificationSuiteHashes: { "save.restart": "unreviewed" },
      }),
    ).toThrow(TypeError);
    expect(() =>
      snapshotRuntimeReadinessConfiguration({
        providerExecutables: {},
        verificationTools: {},
        providerLoginContexts: {
          codex: {
            homeDirectory: process.cwd(),
            configurationDirectory: process.cwd(),
            apiKey: "unsupported-fixture",
          } as never,
        },
      }),
    ).toThrow(TypeError);
  });
});

describe("knowledge observation", () => {
  const input = async (repositoryRoot = f.root) => {
    const value = await readiness();
    return { repositoryRoot, projectId: plan.projectId, readiness: value, now: f.ports.now };
  };
  /** A byte copy of the fixture root for rows that change or migrate tracked knowledge. */
  const copyRoot = async () => {
    const parent = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-copy-"));
    roots.push(parent);
    const copy = resolve(parent, "root");
    await cp(f.root, copy, { recursive: true, verbatimSymlinks: true });
    return copy;
  };

  it("supplements current knowledge without changing application evidence or freshness", async () => {
    const value = await input();
    const result = await observeSupervisionKnowledgeReadiness(value);
    expectChecks(result, value.readiness, { knowledge: "rehashed" });
    expect(result.observation.observedAt).toBe(value.readiness.observation.observedAt);
    expect(JSON.stringify(result)).not.toContain(f.root);
  });

  it.each(["missing", "stale", "normalization", "transaction", "project", "time"])(
    "does not accept %s knowledge evidence",
    async (change) => {
      const mutates = ["missing", "stale", "normalization", "transaction"].includes(change);
      const value = await input(mutates ? await copyRoot() : f.root);
      const root = value.repositoryRoot;
      if (change === "missing") await rm(resolve(root, structuralManifestPath));
      if (change === "stale")
        await writeFile(resolve(root, "src/new.ts"), "export const changed = true;\n");
      if (change === "normalization") {
        await mkdir(resolve(root, "docs"), { recursive: true });
        await writeFile(
          resolve(root, "docs/task.md"),
          "# Task requirements\n\nA new requirement.\n",
        );
        await applyKnowledgeMigrationPlan(
          await createKnowledgeMigrationPlan({ repositoryRoot: root }),
          new Date(),
          () => undefined,
        );
      }
      if (change === "transaction")
        await mkdir(resolve(root, ".lervo/state/knowledge/materialization-transaction"));
      if (change === "project") value.projectId = "prj_foreign";
      if (change === "time") {
        let calls = 0;
        const time = Date.parse(f.ports.now());
        value.now = () => new Date(time + (calls++ === 0 ? 0 : 60_001)).toISOString();
      }
      const result = await observeSupervisionKnowledgeReadiness(value);
      expectChecks(result, value.readiness, { knowledge: unobserved });
    },
  );

  it("accepts unrelated stale normalization only for an exact scoped source", async () => {
    const value = await input(await copyRoot());
    const root = value.repositoryRoot;
    await mkdir(resolve(root, "docs"), { recursive: true });
    await writeFile(resolve(root, "docs/unrelated.md"), "# Unrelated document\n\nUpdated.\n");
    await applyKnowledgeMigrationPlan(
      await createKnowledgeMigrationPlan({ repositoryRoot: root }),
      new Date(),
      () => undefined,
    );
    const unrelated = await observeSupervisionKnowledgeReadiness({
      ...value,
      requiredPaths: ["src/save.ts"],
    });
    expectChecks(unrelated, value.readiness, { knowledge: "rehashed" });
    const required = await observeSupervisionKnowledgeReadiness({
      ...value,
      requiredPaths: ["docs"],
    });
    expectChecks(required, value.readiness, { knowledge: unobserved });
  });

  it("accepts a bounded slow inspection but never refreshes stale application context", async () => {
    const value = await input();
    const started = Date.parse(f.ports.now());
    let calls = 0;
    const now = () => new Date(started + (calls++ === 0 ? 0 : 40_000)).toISOString();
    const result = await observeSupervisionKnowledgeReadiness({ ...value, now });
    expectChecks(result, value.readiness, { knowledge: "rehashed" });
    expect(result.observation.observedAt).toBe(value.readiness.observation.observedAt);
    expect(result.observation.validUntil).toBe(value.readiness.observation.validUntil);
  });

  it("expires a prepared inspection instead of granting a new window on application", async () => {
    const value = await input();
    const preparedInspection = await inspectSupervisionKnowledgeReadiness(value);
    expect(preparedInspection.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const now = () => new Date(Date.parse(preparedInspection.observedAt) + 60_001).toISOString();
    const result = await observeSupervisionKnowledgeReadiness({
      ...value,
      preparedInspection,
      now,
    });
    expectChecks(result, value.readiness, { knowledge: unobserved });
  });

  it("caps fresh task readiness at the original knowledge expiration", async () => {
    const value = await input();
    const preparedInspection = await inspectSupervisionKnowledgeReadiness(value);
    const started = Date.parse(f.ports.now());
    value.readiness.observation.observedAt = new Date(started + 40_000).toISOString();
    value.readiness.observation.validUntil = new Date(started + 70_000).toISOString();
    const result = await observeSupervisionKnowledgeReadiness({
      ...value,
      preparedInspection,
      now: () => new Date(started + 40_000).toISOString(),
    });
    expect(Date.parse(preparedInspection.validUntil)).toBeLessThan(started + 70_000);
    expectChecks(result, value.readiness, { knowledge: "rehashed" }, preparedInspection.validUntil);
  });

  it.each(["failed", "unobserved", "not_required"] as const)(
    "preserves %s application context evidence",
    async (status) => {
      const value = await input();
      checkOf(value.readiness, "knowledge").status = status;
      expect(await observeSupervisionKnowledgeReadiness(value)).toEqual(value.readiness);
    },
  );
});

describe("repository and filesystem scope observation", () => {
  const observe = async (input: Readiness) => {
    const storage = await openReadOnlyProjectStorage(f.root);
    try {
      return await observeSupervisionRepositoryReadiness({
        repositoryRoot: f.root,
        plan,
        readiness: input,
        now: f.ports.now,
        workspaceEvidenceStorage: storage,
      });
    } finally {
      await storage.close();
    }
  };
  const repository = { lease: unobserved, ancestry: unobserved, workspace: unobserved };
  const scopes = { read_scope: unobserved, write_scope: unobserved };

  it("supplements lease, ancestry, workspace and both scopes from one workspace proof", async () => {
    const input = await readiness();
    expectChecks(await observe(input), input, {
      lease: "rehashed",
      ancestry: "rehashed",
      workspace: "rehashed",
      read_scope: "rehashed",
      write_scope: "rehashed",
    });
  });

  it.each(["workspace_absent", "marker_drift", "foreign_path"])(
    "rejects positive adapter claims after %s changes",
    async (change) => {
      const moved = `${f.workspacePath}.moved`;
      const gitDirectory = (
        await execute("git", ["-C", f.workspacePath, "rev-parse", "--absolute-git-dir"])
      ).stdout.trim();
      const markerPath = resolve(gitDirectory, "lervo-workspace-owner.json");
      const marker = await readFile(markerPath);
      try {
        if (change === "workspace_absent") await rename(f.workspacePath, moved);
        if (change === "marker_drift") await writeFile(markerPath, "{}\n");
        if (change === "foreign_path")
          await writeFile(resolve(f.workspacePath, "outside.txt"), "out of scope\n");
        const input = await readiness();
        expectChecks(await observe(input), input, { ...repository, ...scopes });
      } finally {
        if (change === "workspace_absent") await rename(moved, f.workspacePath);
        await writeFile(markerPath, marker);
        await rm(resolve(f.workspacePath, "outside.txt"), { force: true });
      }
    },
  );

  it.each(["failed", "unobserved", "not_required"] as const)(
    "does not promote a %s application write-scope check",
    async (status) => {
      const input = await readiness();
      const check = checkOf(input, "write_scope");
      check.status = status;
      check.evidenceHash = null;
      expectChecks(await observe(input), input, {
        lease: "rehashed",
        ancestry: "rehashed",
        workspace: "rehashed",
        read_scope: "rehashed",
      });
    },
  );

  it("rejects a symlink in an otherwise authorized Git workspace", async () => {
    const path = resolve(f.workspacePath, "src/save.ts");
    const original = await readFile(path);
    await rm(path);
    await symlink(resolve(f.root, "src/save.ts"), path);
    try {
      const input = await readiness();
      expectChecks(await observe(input), input, {
        lease: "rehashed",
        ancestry: "rehashed",
        workspace: "rehashed",
        ...scopes,
      });
    } finally {
      await rm(path);
      await writeFile(path, original);
    }
  });

  it("fences one full workspace proof with the event head and preserves nonrequired checks", async () => {
    const input = await readiness();
    const writeScope = checkOf(input, "write_scope");
    writeScope.status = "not_required";
    writeScope.evidenceHash = null;
    const storage = await openReadOnlyProjectStorage(f.root);
    try {
      const workspaceReads = vi.spyOn(workspaceSource, "readSupervisionWorkspaceSource");
      const latest = storage.events.latest.bind(storage.events);
      let headReads = 0;
      vi.spyOn(storage.events, "latest").mockImplementation(() => {
        const event = latest();
        if (++headReads === 2 && event !== null)
          return { ...event, eventHash: `sha256:${"0".repeat(64)}` };
        return event;
      });
      const observed = await observeSupervisionRepositoryReadiness({
        repositoryRoot: f.root,
        plan,
        readiness: input,
        now: f.ports.now,
        workspaceEvidenceStorage: storage,
      });
      expect(headReads).toBe(2);
      expect(workspaceReads).toHaveBeenCalledTimes(1);
      expectChecks(observed, input, { ...repository, read_scope: unobserved });
    } finally {
      vi.restoreAllMocks();
      await storage.close();
    }
  });
});

describe("dispatch preflight composition", () => {
  /** A still-held owner lease makes withOwner skip its operation; a skipped row must fail. */
  const ownerRuns = async (
    store: NodeSupervisionStore,
    operation: Parameters<NodeSupervisionStore["withOwner"]>[0],
  ) => expect(await store.withOwner(operation)).not.toBeNull();
  const proposed = async () =>
    (await f.ports.propose(
      projectOutcomeSupervision({
        snapshot: f.observation,
        now: f.ports.now(),
        maximumRecoveryDecisions: 1,
      }),
    ))!;

  it.each(["success", "admission_failure", "probe_failure"])(
    "settles both independent final observations before returning (%s)",
    async (outcome) => {
      const combined = operatingContractHash("preflight combined source");
      const plan = { ...(await proposed()), sourceRevisionDigest: combined };
      const knowledge = await inspectSupervisionKnowledgeReadiness({
        repositoryRoot: f.root,
        projectId: plan.projectId,
        requiredPaths: plan.expectedPaths,
        now: f.ports.now,
      });
      const knowledgeSnapshotId = knowledge.sourceSnapshotId;
      if (knowledgeSnapshotId === null) throw new Error("The fixture has no knowledge snapshot.");
      const store = await NodeSupervisionStore.open({
        repositoryRoot: f.root,
        binding: f.binding,
        now: f.ports.now,
      });
      let enterAdmission!: () => void;
      let enterProbe!: () => void;
      const admissionEntered = new Promise<void>((resolve) => {
        enterAdmission = resolve;
      });
      const probeEntered = new Promise<void>((resolve) => {
        enterProbe = resolve;
      });
      let probeSettled = false;
      let admissionSettled = false;
      try {
        await ownerRuns(store, async (session) => {
          const observedSession = {
            ...session,
            readResponsibility: async (assignmentId: string) => {
              enterProbe();
              await admissionEntered;
              probeSettled = true;
              if (outcome === "probe_failure") throw new Error("probe changed");
              return session.readResponsibility(assignmentId);
            },
          };
          const pending = readNodeDispatchPreflight({
            repositoryRoot: f.root,
            plan,
            session: observedSession,
            ports: f.ports,
            configuration: f.runtimeReadiness,
            expectedKnowledgeSnapshotId: knowledgeSnapshotId,
            sourceBinding: {
              authorityDigest: operatingContractHash("preflight authority"),
              taskDigest: f.observation.sourceRevisionDigest,
              combined,
            },
            readAdmission: async () => {
              enterAdmission();
              await probeEntered;
              admissionSettled = true;
              if (outcome === "admission_failure") throw new Error("admission changed");
              return f.ports.readAdmission(plan);
            },
          });
          if (outcome === "success") {
            const result = await pending;
            expect(result.admission.sourceRevisionDigest).toBe(f.observation.sourceRevisionDigest);
            expect(result.readiness.responsibility).toEqual(f.task);
            for (const kind of [
              "provider",
              "tools",
              "verification",
              "knowledge",
              "lease",
              "ancestry",
              "workspace",
            ])
              expect(
                result.readiness.observation.checks.find((check) => check.kind === kind),
              ).toMatchObject({
                status: "passed",
                evidenceHash: expect.stringMatching(/^sha256:/u),
              });
            const { providerLoginContexts: _loginContexts, ...configurationWithoutLogin } =
              f.runtimeReadiness;
            const missingLogin = await readNodeDispatchPreflight({
              repositoryRoot: f.root,
              plan,
              session,
              ports: f.ports,
              configuration: configurationWithoutLogin,
              expectedKnowledgeSnapshotId: knowledgeSnapshotId,
              sourceBinding: {
                authorityDigest: operatingContractHash("preflight authority"),
                taskDigest: f.observation.sourceRevisionDigest,
                combined,
              },
              readAdmission: () => f.ports.readAdmission(plan),
            });
            expect(
              missingLogin.readiness.observation.checks.find((check) => check.kind === "provider"),
            ).toMatchObject({ status: "unobserved", evidenceHash: null });
            expect(
              missingLogin.readiness.observation.checks.find((check) => check.kind === "tools"),
            ).toMatchObject({ status: "passed" });
          } else {
            await expect(pending).rejects.toThrow(
              outcome === "probe_failure" ? "probe changed" : "admission changed",
            );
          }
          expect(probeSettled && admissionSettled).toBe(true);
          expect(await session.readResponsibility(f.task.assignmentId)).not.toBeNull();
        });
      } finally {
        await store.close();
      }
    },
  );

  it("rejects a changed installed mandate before deriving canonical budget readiness", async () => {
    const plan = { ...(await proposed()), effectContract: "work.managed_execution.v1" };
    const { readWorkerReadiness: _readWorkerReadiness, ...canonicalPorts } = f.ports;
    const store = await NodeSupervisionStore.open({
      repositoryRoot: f.root,
      binding: f.binding,
      now: f.ports.now,
    });
    try {
      await ownerRuns(store, async (session) => {
        await expect(
          readNodeDispatchReadiness({
            repositoryRoot: f.root,
            plan,
            session: {
              ...session,
              readMandate: async () => ({
                ...(await session.readMandate()),
                mandateHash: operatingContractHash("changed installed mandate"),
              }),
            },
            ports: canonicalPorts,
            configuration: f.runtimeReadiness,
            sourceBinding: null,
          }),
        ).rejects.toMatchObject({ code: "supervision_binding_invalid" });
      });
    } finally {
      await store.close();
    }
  });

  it("keeps canonical task context fresh through the final parallel probes", async () => {
    const combined = operatingContractHash("canonical preflight source");
    const plan = {
      ...(await proposed()),
      sourceRevisionDigest: combined,
      effectContract: "work.managed_execution.v1",
    };
    const { readWorkerReadiness: _readWorkerReadiness, ...canonicalPorts } = f.ports;
    const store = await NodeSupervisionStore.open({
      repositoryRoot: f.root,
      binding: f.binding,
      now: f.ports.now,
    });
    try {
      await ownerRuns(store, async (session) => {
        const result = await readNodeDispatchReadiness({
          repositoryRoot: f.root,
          plan,
          session: {
            ...session,
            readTaskResponsibility: async () => ({
              responsibility: f.task,
              workstreamRevision: f.observation.workstreamRevision,
            }),
            readTaskAdmission: async () => f.ports.readAdmission(plan),
          },
          ports: canonicalPorts,
          configuration: f.runtimeReadiness,
          sourceBinding: {
            authorityDigest: operatingContractHash("canonical preflight authority"),
            taskDigest: f.observation.sourceRevisionDigest,
            combined,
          },
        });
        expect(
          result.readiness.observation.checks.find((check) => check.kind === "provider"),
        ).toMatchObject({ status: "passed" });
        expect(
          Date.parse(f.ports.now()) - Date.parse(result.readiness.observation.observedAt),
        ).toBeLessThanOrEqual(5000);
        const initialAdmission = await f.ports.readAdmission(plan);
        let admissionReads = 0;
        await expect(
          readNodeDispatchReadiness({
            repositoryRoot: f.root,
            plan,
            session: {
              ...session,
              readTaskResponsibility: async () => ({
                responsibility: f.task,
                workstreamRevision: f.observation.workstreamRevision,
              }),
              readTaskAdmission: async () =>
                ++admissionReads === 1
                  ? initialAdmission
                  : { ...initialAdmission, resourceAdmission: "exhausted" },
            },
            ports: canonicalPorts,
            configuration: f.runtimeReadiness,
            sourceBinding: {
              authorityDigest: operatingContractHash("canonical preflight authority"),
              taskDigest: f.observation.sourceRevisionDigest,
              combined,
            },
          }),
        ).rejects.toMatchObject({ code: "supervision_readiness_changed" });
        expect(admissionReads).toBe(2);
      });
    } finally {
      await store.close();
    }
  });

  it.each([0, 31_000])(
    "dates canonical final checks without extending context validity (%i ms delay)",
    async (finalDelayMs) => {
      const combined = operatingContractHash("slow final admission source");
      const plan = {
        ...(await proposed()),
        sourceRevisionDigest: combined,
        effectContract: "work.managed_execution.v1",
      };
      const { readWorkerReadiness: _readWorkerReadiness, ...canonicalPorts } = f.ports;
      let nowMs = Date.now();
      const initialNowMs = nowMs;
      const now = () => new Date(nowMs).toISOString();
      const knowledge = await inspectSupervisionKnowledgeReadiness({
        repositoryRoot: f.root,
        projectId: plan.projectId,
        requiredPaths: plan.expectedPaths,
        now,
      });
      if (knowledge.sourceSnapshotId === null)
        throw new Error("The fixture has no knowledge snapshot.");
      const knowledgeSnapshotId = knowledge.sourceSnapshotId;
      const store = await NodeSupervisionStore.open({
        repositoryRoot: f.root,
        binding: f.binding,
        now,
      });
      try {
        await ownerRuns(store, async (session) => {
          let taskAdmissionReads = 0;
          let finalAdmissionReads = 0;
          let delayedFinalRead = false;
          const preflight = readNodeDispatchPreflight({
            repositoryRoot: f.root,
            plan,
            session: {
              ...session,
              readTaskResponsibility: async () => ({
                responsibility: f.task,
                workstreamRevision: f.observation.workstreamRevision,
              }),
              readTaskAdmission: async () => {
                taskAdmissionReads++;
                return f.ports.readAdmission(plan);
              },
              readResponsibility: async (assignmentId) => {
                if (!delayedFinalRead) {
                  nowMs += finalDelayMs;
                  delayedFinalRead = true;
                }
                return session.readResponsibility(assignmentId);
              },
            },
            ports: { ...canonicalPorts, now },
            configuration: f.runtimeReadiness,
            expectedKnowledgeSnapshotId: knowledgeSnapshotId,
            sourceBinding: {
              authorityDigest: operatingContractHash("slow final admission authority"),
              taskDigest: f.observation.sourceRevisionDigest,
              combined,
            },
            readAdmission: async () => {
              finalAdmissionReads++;
              if (finalAdmissionReads === 1) nowMs += 8000;
              return { ...(await f.ports.readAdmission(plan)), observedAt: now() };
            },
          });
          if (finalDelayMs !== 0) {
            await expect(preflight).rejects.toMatchObject({ code: "supervision_readiness_stale" });
            expect(taskAdmissionReads).toBe(2);
            expect(finalAdmissionReads).toBe(2);
            return;
          }
          const result = await preflight;
          expect(taskAdmissionReads).toBe(2);
          expect(finalAdmissionReads).toBe(2);
          expect(Date.parse(result.readiness.observation.observedAt)).toBeGreaterThanOrEqual(
            initialNowMs + 8000,
          );
          expect(
            Date.parse(now()) - Date.parse(result.readiness.observation.observedAt),
          ).toBeLessThanOrEqual(5000);
          expect(Date.parse(now()) - Date.parse(result.admission.observedAt)).toBeLessThanOrEqual(
            5000,
          );
        });
      } finally {
        await store.close();
      }
    },
  );
});

// Re-claiming past the lease expiry permanently changes the shared assignment's lease generation,
// so this row must stay the last one in the file.
describe("repository lease authority", () => {
  it("rejects positive adapter claims after lease_generation changes", async () => {
    await claimAssignment({
      repositoryRoot: f.root,
      assignmentId: f.assignment.assignmentId,
      agentId: f.assignment.assigneeAgentId!,
      sessionId: "ses_readiness_reclaim",
      now: new Date(Date.parse(f.assignment.lease!.expiresAt) + 1000),
    });
    const input = await readiness();
    const storage = await openReadOnlyProjectStorage(f.root);
    try {
      expectChecks(
        await observeSupervisionRepositoryReadiness({
          repositoryRoot: f.root,
          plan,
          readiness: input,
          now: f.ports.now,
          workspaceEvidenceStorage: storage,
        }),
        input,
        {
          lease: unobserved,
          ancestry: unobserved,
          workspace: unobserved,
          read_scope: unobserved,
          write_scope: unobserved,
        },
      );
    } finally {
      await storage.close();
    }
  });
});
