// `turn.summary`: what the core recorded about each turn of a workspace's hosted session (Lervo ADE
// sessions, "The turn summary"). A hosted turn has no provider turn ID, so a turn is the session's
// first prepared prompt context at or after the time the interface sent its message, and before
// the next turn's. Every field comes from the repository's records, read on demand.
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import type { TurnSummary, TurnSummaryResult } from "@lervo/session-host-contract";

import { CommandFailure } from "./command-error-output.js";
import { terminalProviderSessionDigest } from "./terminal-event-coordinates.js";
import { locateWorkspaceSession } from "./workspace-launch-service.js";

/** Turns one request summarizes at most. */
const MAX_TURNS = 20;
/** How long before the interface's message time a prompt's context may be recorded: clock skew. */
const CLOCK_SKEW_MS = 5_000;
const PAGE = 500;
const MAX_SEARCHED_PATHS = 10;
const WORKSPACE = /^[A-Za-z0-9_-]{1,64}$/u;

type Payload = Record<string, unknown>;

const payload = (event: EventEnvelope) => event.payload as Payload;
const timeOf = (event: EventEnvelope) => Date.parse(event.occurredAt);
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** A turn the interface names: when its message was sent, and when the next one was, if any. */
export interface TurnWindow {
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
}

const instant = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function turnWindows(arguments_: Record<string, unknown>): {
  workspaceId: string;
  windows: TurnWindow[];
} {
  const { workspaceId, turns } = arguments_;
  const windows: TurnWindow[] = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    const { startedAtMs, endedAtMs } = (turn ?? {}) as Record<string, unknown>;
    const previous = windows.at(-1);
    if (
      !instant(startedAtMs) ||
      (previous !== undefined && previous.startedAtMs > startedAtMs) ||
      (endedAtMs !== undefined && (!instant(endedAtMs) || endedAtMs < startedAtMs))
    ) {
      windows.length = 0;
      break;
    }
    windows.push({ startedAtMs, ...(endedAtMs === undefined ? {} : { endedAtMs }) });
  }
  if (
    typeof workspaceId !== "string" ||
    !WORKSPACE.test(workspaceId) ||
    windows.length === 0 ||
    windows.length !== (Array.isArray(turns) ? turns.length : 0) ||
    windows.length > MAX_TURNS
  )
    throw new CommandFailure(
      "turn_summary_invalid",
      "turn.summary takes workspaceId and 1 to 20 turns with ascending startedAtMs.",
    );
  return { workspaceId, windows };
}

/** Every event of `types`, in the run when one is named, after `from`, oldest first. */
function runEvents(
  storage: ProjectStorage,
  runId: string | undefined,
  types: readonly string[],
  from = 0,
): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  let afterSeq = from;
  for (;;) {
    const page = storage.events.list({
      ...(runId === undefined ? {} : { runId }),
      types,
      afterSeq,
      limit: PAGE,
    });
    events.push(...page);
    if (page.length < PAGE) return events;
    afterSeq = page.at(-1)!.seq;
  }
}

/**
 * The owner rules a schema-15 context counted: how many Lervo prepared and left out. A context
 * without the counts, or whose rule catalog could not be read, has none.
 */
function preparedOwnerRules(value: unknown): { prepared: number; omitted: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const counts = value as Payload;
  const prepared = count(counts.preparedCount);
  const omitted = count(counts.omittedCount);
  if (counts.status === "unavailable" || prepared === undefined || omitted === undefined)
    return undefined;
  return { prepared, omitted };
}

function summary(
  context: EventEnvelope,
  observed: EventEnvelope | undefined,
  selected: readonly EventEnvelope[],
  change: EventEnvelope | undefined,
  usage: readonly EventEnvelope[],
): TurnSummary {
  const searched = selected.filter((event) => payload(event).origin === "agent_query");
  const given = selected.length - searched.length;
  const outcome = observed === undefined ? {} : payload(observed);
  const totals = usage.reduce(
    (sum, event) => {
      const used = (payload(event).usage ?? {}) as Payload;
      const cost = payload(event).costUsd;
      return {
        inputTokens: sum.inputTokens + (count(used.inputTokens) ?? 0),
        cachedInputTokens: sum.cachedInputTokens + (count(used.cachedInputTokens) ?? 0),
        outputTokens: sum.outputTokens + (count(used.outputTokens) ?? 0),
        costUsd: typeof cost === "number" && sum.costUsd !== null ? sum.costUsd + cost : null,
      };
    },
    { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: 0 as number | null },
  );
  const workstreamRevision = count(payload(context).workstreamRevision);
  const ownerRules = preparedOwnerRules(payload(context).appliedInstructions);
  const finalRevision = count(outcome.finalWorkstreamRevision);
  const changedPaths = change === undefined ? undefined : count(payload(change).changedPathCount);
  const ending = text(outcome.ending);
  const { costUsd, ...tokens } = totals;
  return {
    given: {
      documents: given,
      ...(workstreamRevision === undefined ? {} : { workstreamRevision }),
      ...(ownerRules === undefined ? {} : { ownerRules }),
    },
    searched: {
      documents: searched.length,
      paths: searched
        .map((event) => text(payload(event).path))
        .filter((path): path is string => path !== undefined)
        .slice(0, MAX_SEARCHED_PATHS),
    },
    cited: count(outcome.referenceCount) ?? 0,
    outcome: {
      repositoryChanged: outcome.repositoryChanged === true,
      ...(changedPaths === undefined ? {} : { changedPaths }),
      ...(finalRevision === undefined ? {} : { workstreamRevision: finalRevision }),
      completion: text(outcome.completionResult) ?? "not_checked",
      ...(ending === undefined ? {} : { ending }),
    },
    ...(usage.length === 0
      ? {}
      : { usage: { ...tokens, ...(costUsd === null ? {} : { costUsd }) } }),
  };
}

/**
 * Summarizes the turns `windows` name from a session's records: its prepared contexts,
 * turn observations, and selections, and the repository's usage and change records.
 */
export function summarizeSessionTurns(
  records: {
    readonly session: readonly EventEnvelope[];
    readonly usage: readonly EventEnvelope[];
    readonly changes: readonly EventEnvelope[];
  },
  digest: string,
  windows: readonly TurnWindow[],
): TurnSummaryResult {
  const contexts = records.session.filter(
    (event) =>
      event.type === "terminal.context.prepared" &&
      payload(event).providerSessionDigest === digest &&
      timeOf(event) >= windows[0]!.startedAtMs - CLOCK_SKEW_MS,
  );
  const first = contexts[0];
  const later = (events: readonly EventEnvelope[]) =>
    first === undefined ? [] : events.filter((event) => event.seq > first.seq);
  const usage = later(records.usage).filter(
    (event) => ((payload(event).hostedSession ?? {}) as Payload).providerSessionDigest === digest,
  );
  const changes = later(records.changes);
  const turns = windows.map((window, index) => {
    const start = window.startedAtMs;
    // A turn ends where the next one starts, as the interface or the request's order says.
    const next = window.endedAtMs ?? windows[index + 1]?.startedAtMs;
    const within = (time: number) =>
      time >= start - CLOCK_SKEW_MS && (next === undefined || time < next - CLOCK_SKEW_MS);
    const context = contexts.find((event) => within(timeOf(event)));
    if (context === undefined) return null;
    const observed = records.session.find(
      (event) =>
        event.type === "terminal.turn.observed" &&
        payload(event).contextEventId === context.eventId,
    );
    const selected = records.session.filter(
      (event) =>
        event.type === "context.selected" && payload(event).contextEventId === context.eventId,
    );
    const change =
      observed === undefined
        ? undefined
        : changes.find((event) => payload(event).sourceEventId === observed.eventId);
    const end = next === undefined ? Number.POSITIVE_INFINITY : next - CLOCK_SKEW_MS;
    const used = usage.filter((event) => timeOf(event) >= timeOf(context) && timeOf(event) < end);
    return summary(context, observed, selected, change, used);
  });
  return { turns };
}

/**
 * Summarizes the turns of the workspace's current hosted session that started at the given times,
 * from the repository's records. A turn the core did not record, such as one whose prompt hook did
 * not run, is null.
 */
export async function summarizeWorkspaceTurns(
  arguments_: Record<string, unknown>,
): Promise<TurnSummaryResult> {
  const { workspaceId, windows } = turnWindows(arguments_);
  const { previous, repositoryRoot } = await locateWorkspaceSession(workspaceId);
  const digest = terminalProviderSessionDigest(
    previous.provider as "claude" | "codex",
    previous.sessionId,
  );
  const runId = `run_unmanaged_${digest.slice("sha256:".length, "sha256:".length + 24)}`;
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const session = runEvents(storage, runId, [
      "terminal.context.prepared",
      "terminal.turn.observed",
      "context.selected",
    ]);
    // Usage and changes are read only after the first context the request can name.
    const first = session.find(
      (event) =>
        event.type === "terminal.context.prepared" &&
        timeOf(event) >= windows[0]!.startedAtMs - CLOCK_SKEW_MS,
    );
    const after = first === undefined ? undefined : first.seq - 1;
    return summarizeSessionTurns(
      {
        session,
        usage:
          after === undefined
            ? []
            : runEvents(storage, undefined, ["resource.usage.recorded"], after),
        changes:
          after === undefined
            ? []
            : runEvents(storage, undefined, ["repository.change.completed"], after),
      },
      digest,
      windows,
    );
  } finally {
    await storage.close();
  }
}
