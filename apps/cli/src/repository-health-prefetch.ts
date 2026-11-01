import { readRepositoryFile, repositoryFileExists } from "@lervo/context";
import { openReadOnlyProjectStorage } from "@lervo/project-storage";
import {
  createRepositoryLayoutMigrationPlan,
  readRecordedDocumentStalenessReport,
} from "@lervo/repository-knowledge";
import {
  inspectKnowledgeResidentHealth,
  readConvergenceContinuityState,
  readConvergenceOwnerFence,
} from "@lervo/repository-knowledge-runtime";
import { inspectOperatingAttention } from "./operating-attention-inspection.js";
import { readHealthEventHistory } from "./repository-health-events.js";
import { readHealthAppearance } from "./repository-health-appearance.js";
import { projectLearnedNotice } from "./learned-notice-projection.js";
import { refreshLinkWeb } from "./link-web-projection.js";
import {
  readFindReplaySummary,
  runFindReplay,
  summarizeReplay,
  writeFindReplayReport,
} from "./find-replay.js";
import { readLearnedNoticeCursor, writeLearnedNotice } from "./learned-notice-state.js";
import {
  projectRepositoryHealth,
  type HealthProjectionSources,
} from "./repository-health-projection.js";
import {
  beginRepositoryHealthProjection,
  publishRepositoryHealth,
} from "./repository-health-publication.js";
import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";
import { observeRepositoryHead } from "./workstream-repository-head.js";
import { readTerminalKnowledgeLifecycleCacheEntry } from "./terminal-knowledge-lifecycle-cache.js";
import { unknownRepositoryHealth } from "./repository-health-reader.js";

async function state<T>(root: string, path: string): Promise<T | null> {
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readRepositoryFile(root, path, 1024 * 1024),
      ),
    );
    return value?.schemaVersion === 1 ? (value as T) : null;
  } catch {
    return null;
  }
}

/** Called only by detached prefetch or after a resident cycle. No provider, lint or mutation authority. */
export async function prefetchRepositoryHealth(root: string): Promise<void> {
  const generation = await beginRepositoryHealthProjection(root);
  const now = new Date();
  const snapshot = await captureTerminalRepositorySnapshot(root);
  if (!(await repositoryFileExists(root, ".lervo/data/events.sqlite"))) {
    await publishRepositoryHealth(
      root,
      unknownRepositoryHealth(snapshot.revision, now, "event_store_missing"),
      generation,
    );
    return;
  }
  const storage = await openReadOnlyProjectStorage(root);
  try {
    const [
      head,
      resident,
      maintenance,
      continuity,
      ownerRole,
      staleness,
      freshnessCycle,
      capture,
      attention,
      layout,
      cachedLifecycle,
      appearance,
      findReplay,
      linkWeb,
    ] = await Promise.all([
      observeRepositoryHead(root, now),
      inspectKnowledgeResidentHealth(root, now).catch(() => null),
      state<NonNullable<HealthProjectionSources["maintenance"]>>(
        root,
        ".lervo/state/knowledge/maintenance-observation.json",
      ),
      readConvergenceContinuityState(root).catch(() => null),
      readConvergenceOwnerFence(root)
        .then((fence) =>
          fence === null
            ? null
            : {
                role: fence.verdict.role,
                holderLabel: fence.verdict.holder?.label ?? null,
                holderHostHash: fence.verdict.holder?.hostHash ?? null,
              },
        )
        .catch(() => null),
      readRecordedDocumentStalenessReport(root).catch(() => null),
      state<NonNullable<HealthProjectionSources["freshnessCycle"]>>(
        root,
        ".lervo/state/knowledge/freshness-cycle.json",
      ),
      state<{ lastCycleAt: string | null }>(
        root,
        ".lervo/state/knowledge/instruction-capture/state.json",
      ),
      inspectOperatingAttention({ repositoryRoot: root, observedAt: now, cachedSourcesOnly: true }),
      createRepositoryLayoutMigrationPlan({ repositoryRoot: root }).catch(() => null),
      readTerminalKnowledgeLifecycleCacheEntry({
        root,
        repositoryRevision: snapshot.revision,
        supplementalSources: [],
      }),
      readHealthAppearance(root),
      readFindReplaySummary(root),
      // ADR-0551: rebuilt here only when tracked Markdown changed; a failure leaves it unknown.
      refreshLinkWeb(root, now).catch(() => null),
    ]);
    let history: HealthProjectionSources["history"] = null;
    try {
      history = readHealthEventHistory(storage.events, now);
    } catch {
      /* Unreadable evidence stays unknown. */
    }
    const projection = projectRepositoryHealth({
      now,
      repositoryRevision: snapshot.revision,
      headRevision: head?.commit ?? null,
      resident,
      maintenance,
      continuity,
      ownerRole,
      staleness,
      freshnessCycle,
      captureObservedAt: capture?.lastCycleAt ?? null,
      attention,
      layout,
      cachedLifecycle,
      history,
      appearance,
      findReplay,
      linkWeb,
    });
    // A racing repository edit never acquires a current-revision label.
    if ((await captureTerminalRepositorySnapshot(root)).revision === snapshot.revision)
      await publishRepositoryHealth(root, projection, generation);
    // ADR-0549: the learned notice is prepared here, off the prompt path. Failure loses one notice.
    await refreshLearnedNotice(root, now).catch(() => undefined);
    // ADR-0550: a weekly provider-free replay keeps the Find evaluation current.
    await refreshFindReplay(root, now).catch(() => undefined);
  } finally {
    await storage.close();
  }
}

async function refreshLearnedNotice(root: string, now: Date): Promise<void> {
  const cursor = await readLearnedNoticeCursor(root);
  const notice = await projectLearnedNotice({
    root,
    shownThrough: cursor?.shownThrough ?? null,
    now,
  });
  if (notice !== null) await writeLearnedNotice(root, notice);
}

const FIND_REPLAY_INTERVAL_MS = 7 * 86_400_000;

async function refreshFindReplay(root: string, now: Date): Promise<void> {
  const last = await readFindReplaySummary(root);
  if (last !== null && now.getTime() - Date.parse(last.observedAt) < FIND_REPLAY_INTERVAL_MS)
    return;
  // A failed replay records an empty report, so it retries next week instead of on every prefetch.
  const report = await runFindReplay({ root, maximumCases: 40, limit: 8, now }).catch(() =>
    summarizeReplay([], 8, now),
  );
  await writeFindReplayReport(root, report);
}
