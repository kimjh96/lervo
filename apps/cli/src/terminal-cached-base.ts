// ADR-0645: the context server keeps each checkout's base answer current, and the launcher prints
// it for a prompt the server could not take. The launcher leaves a marker for each such prompt,
// which the server records as `terminal.context.base_delivered` on its next served prompt there.
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { listWorkspaces } from "@lervo/agent-workforce";
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
import { prepareTerminalBaseContext } from "./terminal-degraded-context.js";
import { TERMINAL_OBSERVATION_POLICY_VERSION } from "./terminal-event-coordinates.js";
import {
  TERMINAL_CACHED_BASE_DIRECTORY,
  terminalCachedBaseNameDigest,
} from "./terminal-cached-base-turn.js";
import { TERMINAL_CONTEXT_ENVIRONMENT } from "./terminal-context-server.js";
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

async function writeAtomically(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

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
}

/** A marker the launcher may still be writing, which is left for the next prompt. */
const MARKER_SETTLE_MS = 10_000;

function parseMarker(name: string, content: string, now: number): Marker | null {
  const match = MARKER_NAME.exec(name)!;
  const deliveredAt = Number(match[2]);
  if (content === "" && now - deliveredAt < MARKER_SETTLE_MS) return null;
  if (now - deliveredAt > MARKER_RETENTION_MS) return { name, payload: null };
  try {
    const value = JSON.parse(content) as { reason?: unknown; age?: unknown };
    const reason = terminalBaseDeliveryReasons.find((known) => known === value.reason);
    if (
      reason === undefined ||
      !Number.isSafeInteger(value.age) ||
      (value.age as number) < 0 ||
      (value.age as number) > MAXIMUM_CACHE_AGE_MS
    )
      return { name, payload: null };
    return {
      name,
      payload: {
        reason,
        cacheAgeMilliseconds: value.age as number,
        deliveredAt: new Date(deliveredAt).toISOString(),
      },
    };
  } catch {
    return { name, payload: null };
  }
}

/**
 * Files a day old are dropped whatever checkout they name: session turn files matter only to the
 * next Stop, and a removed checkout's base and markers would otherwise stay forever.
 */
async function sweepOldFiles(directory: string, now: number): Promise<void> {
  for (const name of await readdir(directory)) {
    if (!/^[a-f0-9]{16}\.(?:turn|json|\d{13}\.\d{1,10}\.unserved)$/u.test(name)) continue;
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
  /** Whether a workspace that is not removed claims the checkout. */
  claimed: (executionRoot: string) => Promise<boolean>;
  prepare: (evidenceRoot: string, executionRoot: string) => Promise<string[]>;
  openStorage: (evidenceRoot: string) => Promise<DeliveryStorage>;
}

const defaultPorts: TerminalCachedBasePorts = {
  roots: resolveTerminalRoots,
  claimed: async (executionRoot) => {
    const pathDigest = repositoryCoordinateDigest(executionRoot);
    return (await listWorkspaces(executionRoot)).some(
      (workspace) => workspace.pathDigest === pathDigest && workspace.state !== "removed",
    );
  },
  prepare: (evidenceRoot, executionRoot) =>
    prepareTerminalBaseContext(evidenceRoot, performance.now() + PREPARATION_MS, executionRoot),
  openStorage: openProjectStorage,
};

/** Records the checkout's delivery markers at writer schema 14 and removes them either way. */
async function recordDeliveries(
  directory: string,
  key: string,
  open: () => Promise<DeliveryStorage>,
  now: number,
): Promise<number> {
  const names = (await readdir(directory))
    .filter((name) => MARKER_NAME.exec(name)?.[1] === key)
    .sort()
    .slice(0, MAXIMUM_MARKERS);
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
  let recorded = 0;
  if (recordable.length > 0) {
    const storage = await open();
    try {
      if ((storage.writableEventSchemaVersion ?? 1) >= baseDeliveryEventSchemaVersion) {
        storage.events.transact((transaction) => {
          for (const marker of recordable) {
            const id = randomUUID().replaceAll("-", "");
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
          }
        });
        recorded = recordable.length;
      }
    } finally {
      await storage.close();
    }
  }
  // A marker an older writer cannot record, or one too old or malformed, is dropped unrecorded.
  await Promise.all(markers.map((marker) => rm(resolve(directory, marker.name), { force: true })));
  return recorded;
}

/**
 * After a served prompt drained: records the checkout's pending deliveries, then refreshes its
 * cached base when it is missing or older than five minutes. A checkout a workspace claims gets
 * none, because workspace attachment can block its prompts and a cached answer would skip that.
 */
export async function keepTerminalCachedBase(input: {
  store: string;
  cwd: string;
  args: readonly string[];
  environment: Parameters<typeof terminalCachedBaseKey>[2];
  now?: () => number;
  ports?: Partial<TerminalCachedBasePorts>;
}): Promise<{ recorded: number; refreshed: boolean }> {
  const now = input.now ?? Date.now;
  const ports = { ...defaultPorts, ...input.ports };
  const directory = resolve(input.store, TERMINAL_CACHED_BASE_DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const key = terminalCachedBaseKey(input.cwd, input.args, input.environment);
  const file = resolve(directory, `${key}.json`);
  const { evidenceRoot, executionRoot } = await ports.roots(input.cwd);
  // Each step stands alone: a busy store must not keep the base from being refreshed.
  const recorded = await recordDeliveries(
    directory,
    key,
    () => ports.openStorage(evidenceRoot),
    now(),
  ).catch(() => 0);
  await sweepOldFiles(directory, now()).catch(() => undefined);
  if (await ports.claimed(executionRoot)) {
    await rm(file, { force: true });
    return { recorded, refreshed: false };
  }
  const age = await ageMilliseconds(file, now());
  // Modification times carry fractions of a millisecond, so a file just written can look a
  // moment younger than the clock; a second's slack still refreshes one dated in the future.
  if (age !== null && age > -1_000 && age < REFRESH_AFTER_MS) return { recorded, refreshed: false };
  const lines = await ports.prepare(evidenceRoot, executionRoot);
  // A base whose owner rules did not load in time would stand for half an hour without them; the
  // next served prompt tries again instead.
  if (!lines.some((line) => line.startsWith("Applied owner rules: ")))
    return { recorded, refreshed: false };
  await writeAtomically(file, formatTerminalCachedBase(lines, new Date(now())));
  return { recorded, refreshed: true };
}
