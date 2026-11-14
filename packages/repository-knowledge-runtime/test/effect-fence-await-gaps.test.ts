import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  assessCanonicalization,
  RepositoryKnowledgeError,
  sha256,
} from "@lervo/repository-knowledge";

import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";
import { lyingSourceObservation } from "./lying-source-observation.js";

/**
 * Another writer edits a tracked source inside one await of a stage. Decision checks answer with
 * the old capture, so only an exact fence can notice. Every durable write after the edit must
 * come after an exact fence that observed it.
 */
const plan = vi.hoisted(() => ({
  edit: null as string | null,
  fired: false,
  editStack: "",
  root: "",
  path: "",
  exactsAtEdit: -1,
  exacts: (() => 0) as () => number,
  violations: [] as string[],
}));

function editOnce(label: string) {
  if (plan.edit !== label || plan.fired) return;
  plan.fired = true;
  plan.editStack = new Error().stack ?? "";
  appendFileSync(resolve(plan.root, plan.path), `// concurrent edit during ${label}\n`);
  plan.exactsAtEdit = plan.exacts();
}

function fencedWrite(write: string) {
  if (plan.fired && plan.exacts() === plan.exactsAtEdit)
    plan.violations.push(
      `${write} ran after the edit with no exact fence; edit at ${plan.editStack
        .split("\n")
        .filter((line) => line.includes("/src/"))
        .slice(0, 3)
        .join(" < ")}`,
    );
}

const calledFrom = (file: string) => (new Error().stack ?? "").includes(file);

vi.mock("@lervo/repository-knowledge", async (load) => {
  const actual = await load<typeof import("@lervo/repository-knowledge")>();
  return {
    ...actual,
    listCanonicalizationCandidates: async (
      ...args: Parameters<typeof actual.listCanonicalizationCandidates>
    ) => {
      // Only the writer's transition loop lists inside its assignment run.
      if (/at (Object\.)?run \(\S*candidate-resolution\.ts/u.test(new Error().stack ?? ""))
        editOnce("candidate_list");
      return actual.listCanonicalizationCandidates(...args);
    },
    transitionCanonicalizationCandidate: async (
      ...args: Parameters<typeof actual.transitionCanonicalizationCandidate>
    ) => {
      fencedWrite("candidate transition");
      return actual.transitionCanonicalizationCandidate(...args);
    },
    createStoredDocumentNormalizationSubsetCandidate: async (
      ...args: Parameters<typeof actual.createStoredDocumentNormalizationSubsetCandidate>
    ) => {
      fencedWrite("normalization subset candidate");
      return actual.createStoredDocumentNormalizationSubsetCandidate(...args);
    },
  };
});
vi.mock("../src/canonical-disposition-ledger.js", async (load) => {
  const actual = await load<typeof import("../src/canonical-disposition-ledger.js")>();
  return {
    ...actual,
    integratedCanonicalDrafts: async (
      ...args: Parameters<typeof actual.integratedCanonicalDrafts>
    ) => {
      if (calledFrom("canonical-target-preflight.ts")) editOnce("integrated_ledger");
      return actual.integratedCanonicalDrafts(...args);
    },
  };
});
vi.mock("../src/integration-target-sync.js", async (load) => {
  const actual = await load<typeof import("../src/integration-target-sync.js")>();
  return {
    ...actual,
    synchronizeIntegrationTarget: async (
      ...args: Parameters<typeof actual.synchronizeIntegrationTarget>
    ) => {
      fencedWrite("integration target synchronization");
      return actual.synchronizeIntegrationTarget(...args);
    },
  };
});
vi.mock("../src/knowledge-worker-measurement.js", async (load) => {
  const actual = await load<typeof import("../src/knowledge-worker-measurement.js")>();
  return {
    ...actual,
    recordKnowledgeWorkerMeasurement: async (
      ...args: Parameters<typeof actual.recordKnowledgeWorkerMeasurement>
    ) => {
      fencedWrite("provider usage measurement");
      return actual.recordKnowledgeWorkerMeasurement(...args);
    },
  };
});
vi.mock("@lervo/repository-knowledge-compiler", async (load) => {
  const actual = await load<typeof import("@lervo/repository-knowledge-compiler")>();
  return {
    ...actual,
    createNoCapabilityProviderJsonRunner: async (
      ...args: Parameters<typeof actual.createNoCapabilityProviderJsonRunner>
    ) => {
      const runner = await actual.createNoCapabilityProviderJsonRunner(...args);
      const resolveObserved = runner.resolveObserved;
      if (resolveObserved === undefined) return runner;
      return {
        ...runner,
        resolveObserved: async (...input: Parameters<typeof resolveObserved>) => {
          const result = await resolveObserved(...input);
          editOnce("provider_call");
          return result;
        },
      };
    },
  };
});
vi.mock("../src/provider-call.js", async (load) => {
  const actual = await load<typeof import("../src/provider-call.js")>();
  return {
    ...actual,
    reviewKnowledgeJson: async (input: Parameters<typeof actual.reviewKnowledgeJson>[0]) => {
      const items = (input.untrustedSourceData as { candidate?: { items?: unknown[] } }).candidate
        ?.items;
      if (
        plan.edit === "normalization_timeout" &&
        input.task === "independent_normalization_review" &&
        (items?.length ?? 0) > 1
      ) {
        editOnce("normalization_timeout");
        throw Object.assign(
          new RepositoryKnowledgeError(
            "knowledge_compile_failed",
            "The provider JSON runner did not complete (timed_out).",
          ),
          { processStatus: "timed_out" },
        );
      }
      const result = await actual.reviewKnowledgeJson(input);
      if (input.task === "independent_normalization_review") editOnce("normalization_review");
      return result;
    },
  };
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
beforeEach(() => {
  Object.assign(plan, {
    edit: null,
    fired: false,
    exactsAtEdit: -1,
    violations: [],
  });
});
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const git = (root: string, ...args: string[]) =>
  execFileSync(
    "git",
    ["-C", root, "-c", "user.name=T", "-c", "user.email=t@lervo.invalid", ...args],
    {
      encoding: "utf8",
    },
  ).trim();

async function converge(f: Awaited<ReturnType<typeof fixture>>, cycles: number) {
  const observation = lyingSourceObservation(f.root);
  plan.exacts = () => observation.trace.exactSites.length;
  for (let cycle = 0; cycle < cycles; cycle++) {
    await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: `gap-${cycle}`,
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      sourceObservation: observation,
    }).catch((error: unknown) => {
      if ((error as { code?: string }).code !== "source_bytes_changed") throw error;
    });
    if (plan.fired && (await inspectAutonomousKnowledgeStatus(f.storage)).baselineCurrent) break;
  }
}

async function canonicalScenario() {
  const f = await fixture(true, true);
  fixtures.push(f);
  await writeFile(resolve(f.root, "src/runtime.ts"), "export const maximumBackgroundCalls = 3;\n");
  Object.assign(plan, { root: f.root, path: "src/runtime.ts" });
  return f;
}

it.each(["provider_call", "normalization_review", "integrated_ledger"])(
  "fences every durable write after an edit during %s",
  { timeout: 600_000 },
  async (label) => {
    const f = await canonicalScenario();
    plan.edit = label;
    await converge(f, 40);
    expect(plan.fired).toBe(true);
    expect(plan.violations).toEqual([]);
  },
);

it(
  "fences the smaller normalization candidate after an edit during a timed-out review",
  { timeout: 600_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "docs/specs/storage.md"),
      "# Storage\n\nThe runtime keeps durable history in the local event store.\n",
    );
    git(f.root, "add", "docs/specs/storage.md");
    git(f.root, "commit", "-qm", "add storage spec");
    Object.assign(plan, {
      root: f.root,
      path: "docs/specs/storage.md",
      edit: "normalization_timeout",
    });
    await converge(f, 30);
    expect(plan.fired).toBe(true);
    expect(plan.violations).toEqual([]);
  },
);

it(
  "fences the candidate transition after an edit while the candidates are listed",
  { timeout: 600_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await writeFile(resolve(f.root, "src.ts"), "export const localRuntime = true;\n");
    await assessCanonicalization({
      repositoryRoot: f.root,
      beforeRevision: sha256("before"),
      afterRevision: sha256("after"),
      beforeFiles: {},
      afterFiles: { "src.ts": sha256("export const localRuntime = true;\n") },
      disposition: "canonical_sources_current",
      now: new Date(),
    });
    Object.assign(plan, { root: f.root, path: "src.ts", edit: "candidate_list" });
    await converge(f, 30);
    expect(plan.fired).toBe(true);
    expect(plan.violations).toEqual([]);
  },
);
