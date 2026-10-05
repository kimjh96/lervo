import { redactDiagnosticText } from "@lervo/event-contract";

/** ADR-0456 replica and handoff failure stages. */
export const REPOSITORY_REPLICA_STAGES = [
  "protocol",
  "snapshot",
  "bundle",
  "transfer",
  "verify",
  "apply",
  "merge",
  "checkpoint",
  "supersession",
  "lease",
  "rollback",
] as const;

export type RepositoryReplicaStage = (typeof REPOSITORY_REPLICA_STAGES)[number];

/**
 * The structured failure every replica error resolves to. `stderrDigest` and `causeChain` are
 * redacted and bounded; they belong in local logs and receipts, never in canonical events.
 */
export interface RepositoryReplicaFailure {
  code: string;
  stage: RepositoryReplicaStage;
  gitExitCode: number | null;
  stderrDigest: string | null;
  causeChain: string[];
}

const FAILURE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const MAXIMUM_CAUSE_DEPTH = 8;
const MAXIMUM_CAUSE_MESSAGE_LENGTH = 240;
/** Prefix of the single stderr line a peer command writes when it fails. */
const PEER_FAILURE_PREFIX = "lervo-repository-replica-failure-v1 ";

/** A Git process that exited outside its allowed codes; stderr stays in memory until described. */
export class GitCommandError extends Error {
  constructor(
    readonly subcommand: string,
    readonly gitExitCode: number,
    readonly stderr: string,
  ) {
    super(`Git ${subcommand} exited with ${gitExitCode}.`);
    this.name = "GitCommandError";
  }
}

/** Marks the stage that failed for an error that does not carry its own stage. */
export class RepositoryReplicaStageError extends Error {
  constructor(
    readonly code: string,
    readonly stage: RepositoryReplicaStage,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryReplicaStageError";
  }
}

/** A failure a peer command reported, or the transport failure that prevented its report. */
export class RepositoryReplicaPeerError extends Error {
  readonly code: string;
  readonly stage: RepositoryReplicaStage;

  constructor(
    readonly failure: RepositoryReplicaFailure,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryReplicaPeerError";
    this.code = failure.code;
    this.stage = failure.stage;
  }
}

export class RepositoryReplicaCoordinatorError extends Error {
  constructor(
    readonly code: "repository_replica_config_invalid" | "repository_replica_verification_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryReplicaCoordinatorError";
  }
}

/** A failed cycle with its structured failure and whether the local receipt recorded it. */
export class RepositoryReplicaCycleError extends Error {
  readonly code: string;

  constructor(
    readonly replicaId: string,
    readonly failure: RepositoryReplicaFailure,
    readonly receiptRecorded: boolean,
    options: ErrorOptions,
  ) {
    super(`Repository replica ${replicaId} failed at ${failure.stage}.`, options);
    this.name = "RepositoryReplicaCycleError";
    this.code = failure.code;
  }
}

function isStage(value: unknown): value is RepositoryReplicaStage {
  return REPOSITORY_REPLICA_STAGES.includes(value as RepositoryReplicaStage);
}

function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && chain.length < MAXIMUM_CAUSE_DEPTH) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

function ownCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && FAILURE_CODE.test(code) ? code : null;
}

function ownStage(error: unknown): RepositoryReplicaStage | null {
  const stage = (error as { stage?: unknown } | null)?.stage;
  return isStage(stage) ? stage : null;
}

/**
 * Resolves an error chain to its structured failure. The outermost staged error names the code
 * and stage; the first Git or peer failure supplies the exit code and redacted stderr digest.
 */
export function describeRepositoryReplicaFailure(
  error: unknown,
  fallbackStage: RepositoryReplicaStage,
): RepositoryReplicaFailure {
  const chain = causes(error);
  const staged = chain.find((item) => ownStage(item) !== null);
  const stage = staged === undefined ? fallbackStage : ownStage(staged)!;
  const code =
    (staged === undefined ? null : ownCode(staged)) ??
    chain.map(ownCode).find((item) => item !== null) ??
    `repository_replica_${stage}_failed`;
  const peer = chain.find((item) => item instanceof RepositoryReplicaPeerError);
  const gitFailure = chain.find((item) => item instanceof GitCommandError);
  const gitExitCode = gitFailure?.gitExitCode ?? peer?.failure.gitExitCode ?? null;
  const stderr =
    gitFailure === undefined
      ? peer?.failure.stderrDigest == null
        ? null
        : redactDiagnosticText(peer.failure.stderrDigest)
      : gitFailure.stderr.trim().length === 0
        ? null
        : redactDiagnosticText(gitFailure.stderr);
  return {
    code,
    stage,
    gitExitCode,
    stderrDigest: stderr === null || stderr.length === 0 ? null : stderr,
    causeChain: [
      ...chain.map((item) =>
        redactDiagnosticText(
          item instanceof Error ? item.message : "A non-error value was thrown.",
          MAXIMUM_CAUSE_MESSAGE_LENGTH,
        ),
      ),
      ...(peer?.failure.causeChain ?? []).map((item) => `peer: ${item}`),
    ].slice(0, MAXIMUM_CAUSE_DEPTH),
  };
}

/** One log line naming the code, stage, Git exit code, cause chain, and stderr digest. */
export function formatRepositoryReplicaFailure(failure: RepositoryReplicaFailure): string {
  return [
    `${failure.code} at ${failure.stage}`,
    ...(failure.gitExitCode === null ? [] : [`git exit ${failure.gitExitCode}`]),
    failure.causeChain.join(" <- "),
    ...(failure.stderrDigest === null ? [] : [`stderr: ${failure.stderrDigest}`]),
  ].join("; ");
}

export function isRepositoryReplicaFailure(value: unknown): value is RepositoryReplicaFailure {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const failure = value as Partial<RepositoryReplicaFailure>;
  return (
    typeof failure.code === "string" &&
    FAILURE_CODE.test(failure.code) &&
    isStage(failure.stage) &&
    (failure.gitExitCode === null ||
      (Number.isSafeInteger(failure.gitExitCode) &&
        failure.gitExitCode! >= 0 &&
        failure.gitExitCode! <= 255)) &&
    (failure.stderrDigest === null ||
      (typeof failure.stderrDigest === "string" && failure.stderrDigest.length <= 512)) &&
    Array.isArray(failure.causeChain) &&
    failure.causeChain.length <= MAXIMUM_CAUSE_DEPTH &&
    failure.causeChain.every((item) => typeof item === "string" && item.length <= 512)
  );
}

/** The stderr line a failing peer command writes so the coordinator can keep its structure. */
export function encodeRepositoryReplicaPeerFailure(failure: RepositoryReplicaFailure): string {
  return `${PEER_FAILURE_PREFIX}${JSON.stringify(failure)}\n`;
}

/** Recovers a peer's structured failure from its stderr; unstructured output yields null. */
export function parseRepositoryReplicaPeerFailure(stderr: string): RepositoryReplicaFailure | null {
  const line = stderr
    .split("\n")
    .reverse()
    .find((item) => item.startsWith(PEER_FAILURE_PREFIX));
  if (line === undefined) return null;
  try {
    const value: unknown = JSON.parse(line.slice(PEER_FAILURE_PREFIX.length));
    return isRepositoryReplicaFailure(value) ? value : null;
  } catch {
    return null;
  }
}
