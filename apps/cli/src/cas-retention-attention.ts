// ADR-0658: what stops the project CAS from shrinking, as attention issues. The retention pass runs
// in every knowledge worker cycle and records its outcome; a pass that cannot finish, keeps
// stalling, or stops recording must never stay invisible, since the store then grows without bound.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";

type Issue = TerminalLifecycleInspection["issues"][number];

const OBSERVATION = ".lervo/state/knowledge/cas-retention-observation.json";
const WAIT = ".lervo/state/knowledge/cas-retention-wait.json";
/** ADR-0660: work left and no slice for this long is named, well before the stale notice. */
export const CAS_RETENTION_WAITING_MS = 6 * 60 * 60 * 1000;
/** A worker cycle records a pass each time it runs; three days without one is not routine. */
export const CAS_RETENTION_STALE_MS = 3 * 24 * 60 * 60 * 1000;
/** Consecutive passes that reached their sweep with candidates and removed nothing. */
export const CAS_RETENTION_STALL_PASSES = 5;

const COMMANDS: Record<string, (reference: string) => string> = {
  unreadable_reference: (path) =>
    `make ${path} readable by the user that runs Lervo, or remove it if Lervo left it behind (for example: sudo chown -R "$USER" ${path}); Lervo runs without root and never changes it`,
  unsafe_reference: (path) =>
    `replace the link ${path} with the file or directory it points to; Lervo never follows links in its own state`,
  unsupported_reference: (path) =>
    `remove the special file ${path} from Lervo's state directories; only regular files, directories, pipes and sockets are allowed there`,
  unstable_reference: (path) =>
    `stop whatever rewrites ${path} continuously; retention reads it again on the next cycle`,
  bound_exceeded: () =>
    "run lervo state cas-retention --plan to see the store; a finite bound on files, events or record size stopped retention",
  no_space: () =>
    "free some space on the disk that holds .lervo; retention needs a few KiB to record what it prunes",
  failed: () => "run lervo doctor; retention stopped for a reason it could not name",
};

const STALLS: Record<string, string> = {
  read_budget_exhausted:
    "a file in Lervo's state keeps changing faster than one retention slice can read it, so retention stopped asking for slices; stop whatever rewrites the named file, and retention resumes on the next worker cycle",
  inventory_changed:
    "Lervo state files keep changing between a pass's scan and its sweep; retention keeps trying each cycle, and a quieter period lets it finish",
  event_head_changed:
    "events keep arriving between a pass's scan and its sweep; retention keeps trying each cycle, and a quieter period lets it finish",
};

const WAITS: Record<string, string> = {
  live_work:
    "developer work has held this repository for hours, so retention waits; it resumes when the work's lease ends",
  admission_busy:
    "knowledge cycles of this host keep the host admission busy, so retention cannot start; check lervo doctor for a cycle that never ends",
  retention_turn:
    "other repositories on this host keep taking the retention turns; they share one slice every 30 seconds, so this one comes after them",
  failed:
    "retention attempts keep failing; the code names why, and the resident retries with a wait that grows to an hour",
  unknown:
    "no retention slice has run although work is left; check that the knowledge worker runs (lervo doctor)",
};

/** ADR-0660: consecutive failed attempts after which attention names the failure. */
export const CAS_RETENTION_FAILING_ATTEMPTS = 3;

interface Wait {
  cause: string;
  code: string | null;
  failures: number;
}

/** ADR-0660: the last reason a retention-only attempt ran no slice, if it recorded one. */
async function readWait(root: string): Promise<Wait> {
  try {
    const wait = JSON.parse(await readFile(join(root, WAIT), "utf8")) as {
      cause?: unknown;
      code?: unknown;
      failures?: unknown;
    };
    return {
      cause: typeof wait.cause === "string" && wait.cause in WAITS ? wait.cause : "unknown",
      code:
        typeof wait.code === "string" && /^[A-Za-z0-9_]{1,64}$/u.test(wait.code) ? wait.code : null,
      failures: Number.isSafeInteger(wait.failures) ? (wait.failures as number) : 0,
    };
  } catch {
    return { cause: "unknown", code: null, failures: 0 };
  }
}

interface Observation {
  observedAt?: unknown;
  status?: unknown;
  failure?: unknown;
  reference?: unknown;
  stalledPasses?: unknown;
  stallCause?: unknown;
  stallReference?: unknown;
  remaining?: unknown;
}

/** The retention outcome's attention issues, or none while retention runs as it should. */
export async function readCasRetentionAttention(root: string, now = new Date()): Promise<Issue[]> {
  const issues: Issue[] = [];
  const wait = await readWait(root);
  // ADR-0660: failing attempts are named after a few, not left to the six-hour or stale notice.
  if (wait.cause === "failed" && wait.failures >= CAS_RETENTION_FAILING_ATTEMPTS)
    issues.push({
      code: "cas_retention_failing",
      command: `run lervo doctor; retention-only attempts keep failing (${wait.code ?? "failed"}), and the resident retries with a wait that grows to an hour`,
      detail: `${wait.code ?? "failed"} (${wait.failures} attempts)`,
    });
  let observation: Observation;
  try {
    observation = JSON.parse(await readFile(join(root, OBSERVATION), "utf8")) as Observation;
  } catch {
    return issues;
  }
  const observedAt = typeof observation.observedAt === "string" ? observation.observedAt : "";
  const age = now.getTime() - Date.parse(observedAt);
  if (!(age < CAS_RETENTION_STALE_MS))
    issues.push({
      code: "cas_retention_stale",
      command:
        "check that the knowledge worker runs (lervo doctor), that the checkout is on its base branch, and that the disk has space; retention has not recorded a pass since then",
      detail: observedAt === "" ? "no valid observedAt" : observedAt,
    });
  if (
    observation.remaining === true &&
    observation.status !== "unavailable" &&
    age >= CAS_RETENTION_WAITING_MS &&
    age < CAS_RETENTION_STALE_MS
  )
    issues.push({ code: "cas_retention_waiting", command: WAITS[wait.cause]!, detail: wait.cause });
  const failure = typeof observation.failure === "string" ? observation.failure : null;
  if (
    failure !== null &&
    failure in COMMANDS &&
    (observation.status === "unavailable" || failure === "unstable_reference")
  ) {
    const reference = typeof observation.reference === "string" ? observation.reference : "";
    issues.push({
      code: `cas_retention_${failure}`,
      command: COMMANDS[failure]!(reference),
      ...(reference === "" ? {} : { detail: reference }),
    });
  }
  const stalled = observation.stalledPasses;
  const cause = typeof observation.stallCause === "string" ? observation.stallCause : "";
  if (typeof stalled === "number" && stalled >= CAS_RETENTION_STALL_PASSES && cause in STALLS)
    issues.push({
      code: "cas_retention_stalled",
      command: STALLS[cause]!,
      detail: `${stalled} passes removed nothing: ${cause}${
        typeof observation.stallReference === "string" ? ` (${observation.stallReference})` : ""
      }`,
    });
  return issues;
}
