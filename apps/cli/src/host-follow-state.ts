import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { CommandFailure } from "./command-error-output.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";

/**
 * ADR-0575: what one host's follower remembers, beside the ADR-0571 activation journal. Two files
 * keep one writer each: the follower writes its state under its lock, and the owner's `--pause`,
 * `--resume`, and `--pin` write the control file, so neither overwrites the other. Both hold local
 * paths and public release coordinates only, never `gh` output, and are replaced atomically with
 * mode 0600. Every collection is bounded: failed tags by a limit, repository results by the
 * host's registry, and each record is replaced rather than appended.
 */
export const HOST_FOLLOW_FAILED_TAG_LIMIT = 16;

export interface HostFollowFailedTag {
  tag: string;
  failedAt: string;
  code: string;
  /** The follower's activation that was rolled back or restored; null when none switched. */
  activationId: string | null;
}

export type RepositoryUpgradeOutcome = "current" | "blocked" | "failed" | "host_failure";

export interface HostFollowRepositoryResult {
  repositoryRoot: string;
  outcome: RepositoryUpgradeOutcome;
  /** The last plan or receipt status, or null when the command produced no readable result. */
  status: string | null;
  code: string | null;
  rounds: number;
  appliedStages: string[];
  pendingStages: string[];
  /** The last plan id; a blocked repository is applied again only when it changes. */
  planId: string | null;
  /** Failed passes in a row, which space out the retries. */
  attempts: number;
  /** When the follower tries this repository again with the same CLI; null for never. */
  nextAttemptAt: string | null;
  /** Summed from the receipts: waiting for the knowledge admission, and applying after it. */
  waitMs: number | null;
  applyMs: number | null;
  /** Wall time of every `lervo upgrade` the repository took, plans included. */
  elapsedMs: number;
  /**
   * ADR-0579: per round, the plan command's wall time as `plan_command`, then the apply
   * receipt's parts. Absent from passes of earlier CLIs.
   */
  stageTimings?: HostFollowStageTiming[];
}

export interface HostFollowStageTiming {
  round: number;
  stage: string;
  ms: number;
}

/** One pass of `lervo upgrade` over every registered repository, run by one active CLI. */
export interface HostFollowPass {
  /** The `lervo` link target the pass ran; a different target makes the next pass due. */
  cliTarget: string;
  version: string | null;
  finishedAt: string;
  outcome: RepositoryUpgradeOutcome;
  repositories: HostFollowRepositoryResult[];
}

export interface HostFollowState {
  schemaVersion: 1;
  repository: string | null;
  lastCheckAt: string | null;
  lastSeenTag: string | null;
  /** Release-source failures in a row; the poll delay backs off on them. */
  consecutiveSourceFailures: number;
  lastOutcome: { at: string; outcome: string; tag: string | null; code: string | null } | null;
  failedTags: HostFollowFailedTag[];
  /**
   * Written before the follower installs a release and kept until its repository pass settles,
   * so any later process finishes it: `activationId` is chosen before the install and given to
   * it, so only that exact journal record is ever the follower's own; `rollback` names the host
   * failure while the rollback still waits for the host upgrade lock, and `interruptions` counts
   * passes cut short by something other than a stop request.
   */
  inFlight: HostFollowInFlight | null;
  /** Consecutive failed installs of one tag; the tag fails after a bounded count. */
  installFailures: { tag: string; count: number; code: string } | null;
  lastPass: HostFollowPass | null;
}

export interface HostFollowInFlight {
  tag: string;
  activationId: string;
  startedAt: string;
  rollback: { code: string } | null;
  interruptions: number;
}

export interface HostFollowControl {
  schemaVersion: 1;
  paused: boolean;
  pinnedTag: string | null;
  changedAt: string | null;
}

export const emptyFollowState = (): HostFollowState => ({
  schemaVersion: 1,
  repository: null,
  lastCheckAt: null,
  lastSeenTag: null,
  consecutiveSourceFailures: 0,
  lastOutcome: null,
  failedTags: [],
  inFlight: null,
  installFailures: null,
  lastPass: null,
});

export const emptyFollowControl = (): HostFollowControl => ({
  schemaVersion: 1,
  paused: false,
  pinnedTag: null,
  changedAt: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nullableString = (value: unknown) => value === null || typeof value === "string";
const nullableNumber = (value: unknown) => value === null || typeof value === "number";
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function validStageTimings(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        isRecord(item) &&
        Number.isSafeInteger(item.round) &&
        typeof item.stage === "string" &&
        typeof item.ms === "number",
    )
  );
}

function validRepositoryResult(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.repositoryRoot === "string" &&
    ["current", "blocked", "failed", "host_failure"].includes(value.outcome as string) &&
    nullableString(value.status) &&
    nullableString(value.code) &&
    Number.isSafeInteger(value.rounds) &&
    strings(value.appliedStages) &&
    strings(value.pendingStages) &&
    nullableString(value.planId) &&
    Number.isSafeInteger(value.attempts) &&
    nullableString(value.nextAttemptAt) &&
    nullableNumber(value.waitMs) &&
    nullableNumber(value.applyMs) &&
    typeof value.elapsedMs === "number" &&
    (value.stageTimings === undefined || validStageTimings(value.stageTimings))
  );
}

function validState(value: unknown): value is HostFollowState {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  const { lastOutcome, inFlight, lastPass, failedTags, installFailures } = value;
  return (
    nullableString(value.repository) &&
    nullableString(value.lastCheckAt) &&
    nullableString(value.lastSeenTag) &&
    Number.isSafeInteger(value.consecutiveSourceFailures) &&
    (lastOutcome === null ||
      (isRecord(lastOutcome) &&
        typeof lastOutcome.at === "string" &&
        typeof lastOutcome.outcome === "string" &&
        nullableString(lastOutcome.tag) &&
        nullableString(lastOutcome.code))) &&
    Array.isArray(failedTags) &&
    failedTags.every(
      (entry: unknown) =>
        isRecord(entry) &&
        typeof entry.tag === "string" &&
        typeof entry.failedAt === "string" &&
        typeof entry.code === "string" &&
        nullableString(entry.activationId),
    ) &&
    (inFlight === null ||
      (isRecord(inFlight) &&
        typeof inFlight.tag === "string" &&
        typeof inFlight.activationId === "string" &&
        typeof inFlight.startedAt === "string" &&
        (inFlight.rollback === null ||
          (isRecord(inFlight.rollback) && typeof inFlight.rollback.code === "string")) &&
        Number.isSafeInteger(inFlight.interruptions))) &&
    (installFailures === null ||
      (isRecord(installFailures) &&
        typeof installFailures.tag === "string" &&
        Number.isSafeInteger(installFailures.count) &&
        typeof installFailures.code === "string")) &&
    (lastPass === null ||
      (isRecord(lastPass) &&
        typeof lastPass.cliTarget === "string" &&
        nullableString(lastPass.version) &&
        typeof lastPass.finishedAt === "string" &&
        ["current", "blocked", "failed", "host_failure"].includes(lastPass.outcome as string) &&
        Array.isArray(lastPass.repositories) &&
        lastPass.repositories.every(validRepositoryResult)))
  );
}

function validControl(value: unknown): value is HostFollowControl {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.paused === "boolean" &&
    nullableString(value.pinnedTag) &&
    nullableString(value.changedAt)
  );
}

async function readJson<T>(
  path: string,
  valid: (value: unknown) => value is T,
  empty: () => T,
  code: string,
): Promise<T> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    value = undefined;
  }
  if (!valid(value))
    throw new CommandFailure(
      code,
      `${path} is unreadable; the follower left it untouched and changes nothing until it is repaired or removed.`,
      { path },
    );
  return value;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
      flush: true,
    });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export const readFollowState = (layout: HostUpgradeLayout) =>
  readJson(layout.follow.statePath, validState, emptyFollowState, "host_follow_state_invalid");

export const writeFollowState = (layout: HostUpgradeLayout, state: HostFollowState) =>
  writeJson(layout.follow.statePath, state);

export const readFollowControl = (layout: HostUpgradeLayout) =>
  readJson(
    layout.follow.controlPath,
    validControl,
    emptyFollowControl,
    "host_follow_control_invalid",
  );

export const writeFollowControl = (layout: HostUpgradeLayout, control: HostFollowControl) =>
  writeJson(layout.follow.controlPath, control);

/** The owner's `--pause`, `--resume` (clears the pause and the pin), or `--pin <tag>`. */
export async function changeFollowControl(
  layout: HostUpgradeLayout,
  change: { kind: "pause" } | { kind: "resume" } | { kind: "pin"; tag: string },
  changedAt: string,
): Promise<HostFollowControl> {
  const control = await readFollowControl(layout);
  const next: HostFollowControl =
    change.kind === "pause"
      ? { ...control, paused: true, changedAt }
      : change.kind === "resume"
        ? { ...control, paused: false, pinnedTag: null, changedAt }
        : { ...control, pinnedTag: change.tag, changedAt };
  await writeFollowControl(layout, next);
  return next;
}

/** Records a tag the follower must never install again by itself, keeping the newest entries. */
export function withFailedTag(
  state: HostFollowState,
  failed: HostFollowFailedTag,
): HostFollowState {
  return {
    ...state,
    failedTags: [...state.failedTags.filter((entry) => entry.tag !== failed.tag), failed].slice(
      -HOST_FOLLOW_FAILED_TAG_LIMIT,
    ),
  };
}
