import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  lintRepositoryKnowledge,
  loadRepositoryKnowledgePolicy,
  migrationPlanWritesOnlyRebuildableProjections,
  repositoryKnowledgeBuilt,
  RepositoryKnowledgeError,
} from "@lervo/repository-knowledge";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { recordStructuralMaterialization } from "./structural-materialization-event.js";
import { launchDetachedKnowledgeWorker } from "./detached-knowledge-worker.js";

const BOOTSTRAP_STATE_PATH = ".lervo/state/knowledge/bootstrap.json";
const IN_PROGRESS_LIFETIME_MS = 15 * 60_000;
const FAILURE_RETRY_DELAY_MS = 60 * 60_000;

export type KnowledgeBootstrapStatus = "in_progress" | "built" | "deferred" | "failed";

/** Local, rebuildable bootstrap progress; the applied generation itself is the durable record. */
export interface KnowledgeBootstrapState {
  schemaVersion: 1;
  status: KnowledgeBootstrapStatus;
  updatedAt: string;
  reason: "tracked_paths_in_plan" | "migration_apply_failed" | "bootstrap_error" | null;
}

const BUILDING_NOTICE =
  "Repository knowledge is not built in this checkout yet; a background build started and usually takes about a minute. Until it finishes, `lervo knowledge query` returns no recommendations, so read AGENTS.md and the tracked documentation directly.";
const DEFERRED_NOTICE =
  "Repository knowledge is not built in this checkout, and building it would change tracked files. Ask the owner to review and apply `lervo migrate knowledge`; until then, read AGENTS.md and the tracked documentation directly.";
const MANUAL_NOTICE =
  "Repository knowledge is not built in this checkout. Run `lervo migrate knowledge` to build it; until then, read AGENTS.md and the tracked documentation directly.";

async function readBootstrapState(root: string): Promise<KnowledgeBootstrapState | null> {
  try {
    const value = JSON.parse(
      await readFile(resolve(root, BOOTSTRAP_STATE_PATH), "utf8"),
    ) as Partial<KnowledgeBootstrapState>;
    return value.schemaVersion === 1 &&
      typeof value.status === "string" &&
      typeof value.updatedAt === "string"
      ? (value as KnowledgeBootstrapState)
      : null;
  } catch {
    return null;
  }
}

async function writeBootstrapState(root: string, state: KnowledgeBootstrapState): Promise<void> {
  const path = resolve(root, BOOTSTRAP_STATE_PATH);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

/**
 * Builds repository knowledge once for a checkout that has none. It applies the ordinary refresh
 * plan only when that plan writes nothing but Git-ignored, Lervo-generated projections.
 */
export async function runKnowledgeBootstrap(input: {
  root: string;
  now?: () => Date;
}): Promise<KnowledgeBootstrapState> {
  const now = input.now ?? (() => new Date());
  const settle = async (
    status: KnowledgeBootstrapStatus,
    reason: KnowledgeBootstrapState["reason"],
  ): Promise<KnowledgeBootstrapState> => {
    // A concurrent build may finish first; an applied generation always wins.
    const built = await repositoryKnowledgeBuilt(input.root);
    const state: KnowledgeBootstrapState = {
      schemaVersion: 1,
      status: built ? "built" : status,
      updatedAt: now().toISOString(),
      reason: built ? null : reason,
    };
    await writeBootstrapState(input.root, state);
    return state;
  };
  if (await repositoryKnowledgeBuilt(input.root)) return settle("built", null);
  try {
    const [policy, supplementalSources] = await Promise.all([
      loadRepositoryKnowledgePolicy(input.root),
      collectLocalKnowledgeSources(input.root),
    ]);
    const plan = await createKnowledgeMigrationPlan({
      repositoryRoot: input.root,
      // Refresh rebuilds projections without proposing layout moves, which need owner review.
      mode: "refresh",
      repairMode: "none",
      reconciliationMode: "full",
      supplementalSources,
    });
    if (!migrationPlanWritesOnlyRebuildableProjections(plan, policy.publicationRoot))
      return settle("deferred", "tracked_paths_in_plan");
    const storage = await openProjectStorage(input.root);
    try {
      // Throwing from the recorder rolls the applied projections back.
      await applyKnowledgeMigrationPlan(
        plan,
        now(),
        async (applied) => {
          const validation = await lintRepositoryKnowledge(input.root, {
            allowTransactionPlanId: plan.planId,
            supplementalSources,
          });
          if (!validation.valid)
            throw new RepositoryKnowledgeError(
              "knowledge_apply_failed",
              "Bootstrapped knowledge did not lint valid.",
            );
          await recordStructuralMaterialization({ storage, plan, applied, validation });
        },
        { supplementalSources },
      );
    } catch {
      return settle("failed", "migration_apply_failed");
    } finally {
      await storage.close();
    }
    return settle("built", null);
  } catch {
    return settle("failed", "bootstrap_error");
  }
}

/**
 * Returns the terminal context line for a checkout without built knowledge, starting at most one
 * detached build. Returns null when knowledge is built.
 */
export async function terminalKnowledgeBootstrapNotice(input: {
  root: string;
  hookRuntime: string | undefined;
  now: Date;
}): Promise<string | null> {
  if (await repositoryKnowledgeBuilt(input.root)) return null;
  const state = await readBootstrapState(input.root);
  const age = state === null ? Infinity : input.now.getTime() - Date.parse(state.updatedAt);
  if (state?.status === "deferred") return DEFERRED_NOTICE;
  if (state?.status === "in_progress" && age < IN_PROGRESS_LIFETIME_MS) return BUILDING_NOTICE;
  if (state?.status === "failed" && age < FAILURE_RETRY_DELAY_MS) return MANUAL_NOTICE;
  if (input.hookRuntime === undefined) return MANUAL_NOTICE;
  await writeBootstrapState(input.root, {
    schemaVersion: 1,
    status: "in_progress",
    updatedAt: input.now.toISOString(),
    reason: null,
  });
  return (await launchDetachedKnowledgeWorker({
    root: input.root,
    entry: input.hookRuntime,
    args: ["knowledge-bootstrap"],
  }))
    ? BUILDING_NOTICE
    : MANUAL_NOTICE;
}
