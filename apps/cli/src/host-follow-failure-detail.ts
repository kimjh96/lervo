/**
 * ADR-0575: what made a repository's `lervo upgrade` fail, kept in follower state so a rolled
 * back release can be diagnosed without guessing. It is bounded and holds no message or free
 * text: codes, component states as the readiness receipt names them, counts and a process id.
 */
export interface RepositoryUpgradeFailureDetail {
  /** The Node stage's readiness observation, when the replacement did not become ready. */
  readiness?: {
    /** The predecessor baseline: `observed`, `stale`, `unavailable` or `not_applicable`. */
    baseline: string;
    lastStatus: string | null;
    lastProcessId: number | null;
    observations: number;
    blockers: Array<{ component: string; observed: string; baseline: string | null }>;
  };
  /** The original failure code when recovery replaced the error. */
  failedCode?: string;
  recovery?: "restored" | "failed";
  recoveryFailureCode?: string;
}

/** The detail of the repository whose failure rolled a release back, with that repository. */
export interface HostFollowFailureDetail extends RepositoryUpgradeFailureDetail {
  repositoryRoot: string;
}

/** At most this many blockers are kept, in the readiness receipt's component order. */
export const FAILURE_DETAIL_BLOCKER_LIMIT = 8;
/** A component state such as `pending` or `unavailable:hub_unavailable`. */
const STATE = /^[a-z][a-z_]{0,31}(?::[a-z0-9_]{1,64})?$/u;
const CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const COMPONENT = /^[a-zA-Z]{1,40}$/u;
const STATUS = /^[a-z_]{1,32}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const matches = (pattern: RegExp, value: unknown): value is string =>
  typeof value === "string" && pattern.test(value);
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function readinessDetail(
  value: unknown,
): NonNullable<RepositoryUpgradeFailureDetail["readiness"]> | null {
  if (!isRecord(value) || !matches(STATUS, value.baseline) || !count(value.observations))
    return null;
  if (value.lastStatus !== null && !matches(STATUS, value.lastStatus)) return null;
  if (value.lastProcessId !== null && !count(value.lastProcessId)) return null;
  if (!Array.isArray(value.blockers)) return null;
  const blockers = value.blockers
    .slice(0, FAILURE_DETAIL_BLOCKER_LIMIT)
    .flatMap((item) =>
      isRecord(item) &&
      matches(COMPONENT, item.component) &&
      matches(STATE, item.observed) &&
      (item.baseline === null || matches(STATE, item.baseline))
        ? [{ component: item.component, observed: item.observed, baseline: item.baseline }]
        : [],
    );
  return {
    baseline: value.baseline,
    lastStatus: value.lastStatus,
    lastProcessId: value.lastProcessId,
    observations: value.observations,
    blockers,
  };
}

/**
 * The bounded detail of a failed command envelope's `error`, or undefined when it carries none.
 * Anything of an unexpected shape is dropped, never kept as text.
 */
export function repositoryUpgradeFailureDetail(
  error: unknown,
): RepositoryUpgradeFailureDetail | undefined {
  if (!isRecord(error)) return undefined;
  const readiness = readinessDetail(error.readiness);
  const detail: RepositoryUpgradeFailureDetail = {
    ...(readiness === null ? {} : { readiness }),
    ...(matches(CODE, error.failedCode) ? { failedCode: error.failedCode } : {}),
    ...(error.recovery === "restored" || error.recovery === "failed"
      ? { recovery: error.recovery }
      : {}),
    ...(matches(CODE, error.recoveryFailureCode)
      ? { recoveryFailureCode: error.recoveryFailureCode }
      : {}),
  };
  return Object.keys(detail).length === 0 ? undefined : detail;
}

/** Whether a stored detail is exactly one this CLI writes. */
export function validFailureDetail(value: unknown, withRepository: boolean): boolean {
  if (!isRecord(value)) return false;
  const { repositoryRoot, ...rest } = value;
  if (withRepository ? typeof repositoryRoot !== "string" : repositoryRoot !== undefined)
    return false;
  const parsed = repositoryUpgradeFailureDetail(rest);
  return (
    parsed !== undefined &&
    JSON.stringify(parsed) === JSON.stringify(rest) &&
    (parsed.readiness === undefined ||
      parsed.readiness.blockers.length <= FAILURE_DETAIL_BLOCKER_LIMIT)
  );
}

/** One bounded line for status output: the codes and the readiness blockers. */
export function formatFailureDetail(detail: RepositoryUpgradeFailureDetail): string {
  const parts: string[] = [];
  if (detail.readiness !== undefined) {
    const { readiness } = detail;
    const blockers = readiness.blockers
      .map(
        (blocker) =>
          `${blocker.component} ${blocker.observed}${blocker.baseline === null ? "" : ` (was ${blocker.baseline})`}`,
      )
      .join(", ");
    parts.push(
      `readiness ${readiness.lastStatus ?? "unpublished"} after ${readiness.observations} observations, baseline ${readiness.baseline}${blockers === "" ? "" : `; blockers: ${blockers}`}`,
    );
  }
  if (detail.failedCode !== undefined) parts.push(`failed ${detail.failedCode}`);
  if (detail.recovery !== undefined)
    parts.push(
      `recovery ${detail.recovery}${detail.recoveryFailureCode === undefined ? "" : ` (${detail.recoveryFailureCode})`}`,
    );
  return parts.join("; ");
}
