// ADR-0645: the context server keeps each checkout's base answer current, and the launcher prints
// it for a prompt the server could not take. The launcher leaves a marker for each such prompt,
// which the server records as `terminal.context.base_delivered` on its next served prompt there.
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { isConversationWorkspace, readNewestCheckoutWorkspace } from "@lervo/agent-workforce";
import { replaceFile } from "@lervo/filesystem-durability";
import { baseDeliveryEventSchemaVersion } from "@lervo/event-contract";
import {
  openProjectStorage,
  repositoryCoordinateDigest,
  type ProjectStorage,
} from "@lervo/project-storage";
import {
  terminalBaseDeliveryReasons,
  type TerminalContextBaseDeliveredEventPayload,
} from "@lervo/schemas";

import { capContextBytes, MAXIMUM_COMPACT_CONTEXT_BYTES } from "./terminal-context-budget.js";
import { prepareTerminalBaseParts } from "./terminal-degraded-context.js";
import { TERMINAL_OBSERVATION_POLICY_VERSION } from "./terminal-event-coordinates.js";
import {
  TERMINAL_CACHED_BASE_DIRECTORY,
  terminalCachedBaseNameDigest,
} from "./terminal-cached-base-turn.js";
import { TERMINAL_CONTEXT_ENVIRONMENT } from "./terminal-context-request.js";
import { resolveTerminalRoots } from "./terminal-roots.js";

/** The launcher prints a cached base younger than this; the server refreshes it well before. */
const REFRESH_AFTER_MS = 5 * 60_000;
const MAXIMUM_CACHE_AGE_MS = 30 * 60_000;
const MARKER_RETENTION_MS = 24 * 60 * 60_000;
const MAXIMUM_MARKERS = 32;
const MARKER_NAME = /^([a-f0-9]{16})\.(\d{13})\.(\d{1,10})\.unserved$/u;
/** How long the server spends preparing a base, so a slow store never holds it busy for long. */
const PREPARATION_MS = 1_000;

/**
 * The file name stem the launcher derives from its real working directory, its arguments, and the
 * variables the server compares, which choose the stores a hook reads; the request carries all
 * three. A session whose stores differ from the server's never matches a base the server wrote.
 */
export function terminalCachedBaseKey(
  cwd: string,
  args: readonly string[],
  environment: Readonly<Record<(typeof TERMINAL_CONTEXT_ENVIRONMENT)[number], string | null>>,
): string {
  // JSON keeps an unset variable (null) apart from an empty one, as the server's comparison does.
  const values = JSON.stringify(
    TERMINAL_CONTEXT_ENVIRONMENT.map((name) => environment[name] ?? null),
  );
  return terminalCachedBaseNameDigest([cwd, ...args, values].join("\0"));
}

/** The prompt answer the launcher prints, saying it is the cached base and when it was made. */
export function formatTerminalCachedBase(lines: readonly string[], preparedAt: Date): string {
  const [pointer, ...rest] = lines;
  const notice = `Lervo cached base context, prepared ${preparedAt.toISOString()}: the context server could not take this prompt, so no documents, repository state, or knowledge health were inspected and this turn records no context.`;
  const additionalContext = capContextBytes(
    [pointer, notice, ...rest].filter((line) => line !== undefined).join("\n\n"),
    MAXIMUM_COMPACT_CONTEXT_BYTES,
  );
  return `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } })}\n`;
}

/** Replaces `path` with `content`, synced with its directory, so a marker's identity survives a
 * power loss whenever the store's commit that follows it does. */
const writeAtomically = (path: string, content: string) => replaceFile(path, content);

async function ageMilliseconds(path: string, now: number): Promise<number | null> {
  try {
    return now - (await lstat(path)).mtimeMs;
  } catch {
    return null;
  }
}

interface Marker {
  name: string;
  payload: TerminalContextBaseDeliveredEventPayload | null;
  /** The random identity the server gave the delivery, once it tried to record it. */
  id: string | null;
}

/** A marker the launcher may still be writing, which is left for the next prompt. */
const MARKER_SETTLE_MS = 10_000;

function parseMarker(name: string, content: string, now: number): Marker | null {
  const match = MARKER_NAME.exec(name)!;
  const deliveredAt = Number(match[2]);
  if (content === "" && now - deliveredAt < MARKER_SETTLE_MS) return null;
  const dropped = { name, payload: null, id: null };
  if (now - deliveredAt > MARKER_RETENTION_MS) return dropped;
  try {
    const value = JSON.parse(content) as { reason?: unknown; age?: unknown; id?: unknown };
    const reason = terminalBaseDeliveryReasons.find((known) => known === value.reason);
    if (
      reason === undefined ||
      !Number.isSafeInteger(value.age) ||
      (value.age as number) < 0 ||
      (value.age as number) > MAXIMUM_CACHE_AGE_MS
    )
      return dropped;
    return {
      name,
      payload: {
        reason,
        cacheAgeMilliseconds: value.age as number,
        deliveredAt: new Date(deliveredAt).toISOString(),
      },
      id: typeof value.id === "string" && /^[a-f0-9]{32}$/u.test(value.id) ? value.id : null,
    };
  } catch {
    return dropped;
  }
}

/**
 * Files a day old are dropped whatever checkout they name: session turn files matter only to the
 * next Stop, and a removed checkout's base and markers would otherwise stay forever.
 */
async function sweepOldFiles(directory: string, now: number): Promise<void> {
  for (const name of await readdir(directory)) {
    // A writer that exited mid-write leaves its `.tmp` beside the file it was replacing.
    if (!/^\.?[a-f0-9]{16}\.(?:turn|json|retry|\d{13}\.\d{1,10}\.unserved|.+\.tmp)$/u.test(name))
      continue;
    const age = await ageMilliseconds(resolve(directory, name), now);
    if (age !== null && age > MARKER_RETENTION_MS)
      await rm(resolve(directory, name), { force: true });
  }
}

type DeliveryStorage = Pick<
  ProjectStorage,
  "writableEventSchemaVersion" | "manifest" | "events" | "close"
>;

/** What keeping the cached base reads beyond its own directory; tests replace each. */
export interface TerminalCachedBasePorts {
  roots: (cwd: string) => Promise<{ evidenceRoot: string; executionRoot: string }>;
  /**
   * Whether a worker workspace claims the checkout: its newest record that is not removed. A
   * conversation's generation keeps the cached base like any linked worktree.
   */
  claimed: (executionRoot: string) => Promise<boolean>;
  /**
   * Prepares the base by `deadline`, a `performance.now()` time; `abandoned` says a read reached
   * the deadline and may still be running.
   */
  prepare: (
    evidenceRoot: string,
    executionRoot: string,
    deadline: number,
  ) => Promise<{ lines: string[]; abandoned: boolean }>;
  openStorage: (evidenceRoot: string) => Promise<DeliveryStorage>;
}

const defaultPorts: TerminalCachedBasePorts = {
  roots: resolveTerminalRoots,
  claimed: async (executionRoot) => {
    const newest = await readNewestCheckoutWorkspace(
      executionRoot,
      repositoryCoordinateDigest(executionRoot),
    );
    return newest !== null && !isConversationWorkspace(newest);
  },
  prepare: (evidenceRoot, executionRoot, deadline) =>
    prepareTerminalBaseParts(evidenceRoot, deadline, 2048, executionRoot),
  openStorage: openProjectStorage,
};

/** The checkout's delivery markers, oldest first, at most 32. */
async function markerNames(directory: string, key: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => MARKER_NAME.exec(name)?.[1] === key)
    .sort()
    .slice(0, MAXIMUM_MARKERS);
}

/**
 * Records the checkout's delivery markers at writer schema 14. Each delivery gets a random
 * identity, written into its marker before the record, so a marker that a failed removal or an
 * exit left behind is recognised and never recorded twice, and no identity reveals the checkout.
 * A marker stays until it was recorded or proved unrecordable, so a busy store only delays it.
 */
async function recordDeliveries(
  directory: string,
  names: readonly string[],
  open: () => Promise<DeliveryStorage>,
  now: number,
): Promise<number> {
  if (names.length === 0) return 0;
  const markers: Marker[] = [];
  for (const name of names) {
    const path = resolve(directory, name);
    const stat = await lstat(path).catch(() => null);
    const content =
      stat?.isFile() === true && stat.size <= 256
        ? await readFile(path, "utf8").catch(() => "")
        : "";
    const marker = parseMarker(name, content, now);
    if (marker !== null) markers.push(marker);
  }
  const recordable = markers.filter((marker) => marker.payload !== null);
  for (const marker of recordable)
    if (marker.id === null) {
      marker.id = randomUUID().replaceAll("-", "");
      await writeAtomically(
        resolve(directory, marker.name),
        JSON.stringify({
          reason: marker.payload!.reason,
          age: marker.payload!.cacheAgeMilliseconds,
          id: marker.id,
        }),
      );
    }
  let recorded = 0;
  if (recordable.length > 0) {
    const storage = await open();
    try {
      if ((storage.writableEventSchemaVersion ?? 1) >= baseDeliveryEventSchemaVersion) {
        storage.events.transact((transaction) => {
          for (const marker of recordable) {
            const id = marker.id!;
            if (storage.events.get(`evt_${id}`) !== null) continue;
            transaction.append({
              eventId: `evt_${id}`,
              projectId: storage.manifest.projectId,
              runId: `run_basedelivery_${id}`,
              sessionId: `ses_basedelivery_${id}`,
              type: "terminal.context.base_delivered",
              occurredAt: marker.payload!.deliveredAt,
              actor: { kind: "system" },
              schemaVersion: baseDeliveryEventSchemaVersion,
              policyVersion: TERMINAL_OBSERVATION_POLICY_VERSION,
              payload: marker.payload!,
            });
            recorded += 1;
          }
        });
      }
    } finally {
      await storage.close();
    }
  }
  // Recorded, or one an older writer cannot record, too old, or malformed: dropped either way.
  await Promise.all(markers.map((marker) => rm(resolve(directory, marker.name), { force: true })));
  return recorded;
}

/** Day-old files are swept at most hourly, not at every served prompt. */
const SWEEP_INTERVAL_MS = 60 * 60_000;
const lastSweeps = new Map<string, number>();

/**
 * After a served prompt drained: records the checkout's pending deliveries, then refreshes its
 * cached base when it is missing or older than five minutes. A checkout a workspace claims gets
 * none, because workspace attachment can block its prompts and a cached answer would skip that.
 * With a fresh base and no markers it stats the base and lists the directory, and does nothing
 * more.
 *
 * `settled` is false when a read reached the preparation deadline: its work may still run, and
 * the server must not serve the next hook beside it, so it exits as after an overrun.
 */
export async function keepTerminalCachedBase(input: {
  store: string;
  cwd: string;
  args: readonly string[];
  environment: Parameters<typeof terminalCachedBaseKey>[2];
  now?: () => number;
  ports?: Partial<TerminalCachedBasePorts>;
}): Promise<{ recorded: number; refreshed: boolean; settled: boolean }> {
  const now = input.now ?? Date.now;
  const ports = { ...defaultPorts, ...input.ports };
  const directory = resolve(input.store, TERMINAL_CACHED_BASE_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (now() - (lastSweeps.get(directory) ?? Number.NEGATIVE_INFINITY) > SWEEP_INTERVAL_MS) {
    lastSweeps.set(directory, now());
    await sweepOldFiles(directory, now()).catch(() => undefined);
  }
  const key = terminalCachedBaseKey(input.cwd, input.args, input.environment);
  const file = resolve(directory, `${key}.json`);
  const age = await ageMilliseconds(file, now());
  // Modification times carry fractions of a millisecond, so a file just written can look a
  // moment younger than the clock; a second's allowance still refreshes one dated in the future.
  const fresh = age !== null && age > -1_000 && age < REFRESH_AFTER_MS;
  const names = await markerNames(directory, key);
  if (fresh && names.length === 0) return { recorded: 0, refreshed: false, settled: true };
  const { evidenceRoot, executionRoot } = await ports.roots(input.cwd);
  // Each step stands alone: a busy store must not keep the base from being refreshed.
  const recorded = await recordDeliveries(
    directory,
    names,
    () => ports.openStorage(evidenceRoot),
    now(),
  ).catch(() => 0);
  if (fresh) return { recorded, refreshed: false, settled: true };
  if (await ports.claimed(executionRoot)) {
    await rm(file, { force: true });
    return { recorded, refreshed: false, settled: true };
  }
  // A checkout whose base could not be prepared waits five minutes before the next attempt, so a
  // slow or failing store does not restart or hold the server at every prompt.
  const retry = resolve(directory, `${key}.retry`);
  const waited = await ageMilliseconds(retry, now());
  if (waited !== null && waited > -1_000 && waited < REFRESH_AFTER_MS)
    return { recorded, refreshed: false, settled: true };
  const { lines, abandoned } = await ports.prepare(
    evidenceRoot,
    executionRoot,
    performance.now() + PREPARATION_MS,
  );
  const settled = !abandoned;
  // A base whose owner rules did not load in time would stand for half an hour without them; the
  // next served prompt after the wait tries again instead.
  if (!lines.some((line) => line.startsWith("Applied owner rules: "))) {
    await writeAtomically(retry, "").catch(() => undefined);
    return { recorded, refreshed: false, settled };
  }
  // A base that cannot be written leaves the old one to expire and waits like a failed
  // preparation; `settled` still reports reads either way.
  const written = await writeAtomically(
    file,
    formatTerminalCachedBase(lines, new Date(now())),
  ).then(
    () => true,
    () => false,
  );
  if (!written) {
    await writeAtomically(retry, "").catch(() => undefined);
    return { recorded, refreshed: false, settled };
  }
  await rm(retry, { force: true }).catch(() => undefined);
  return { recorded, refreshed: true, settled };
}
