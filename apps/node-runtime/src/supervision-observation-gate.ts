import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { OutcomeSupervisionCycleResult } from "@lervo/orchestrator";

/** Even an unchanged source is observed again this often, the cadence of full history audits. */
export const FULL_OBSERVATION_INTERVAL_MS = 900_000;
/** A larger input tree is not stamped, so every wake-up observes the full source. */
const MAXIMUM_STAMPED_ENTRIES = 4_096;

/** The task source's inputs outside the event store, as files and as trees walked to every entry. */
export interface SupervisionObservationPaths {
  files: readonly string[];
  trees: readonly string[];
}

export interface SupervisionObservationInputs {
  head(): { seq: number; eventHash: string } | null;
  paths(): Promise<SupervisionObservationPaths>;
  /** Deadlines of duties a full cycle performs; a lapsed one forces observation. */
  deadlines(): readonly (number | null)[];
  /** The history tail check a skipped wake-up still performs; it throws when it cannot run. */
  auditHistory(): Promise<void>;
}

interface SettledObservation {
  disposition: "idle" | "blocked";
  head: string;
  stamp: string;
  observedAt: number;
  /** Future duty deadlines known at settlement; a source may stop reporting one once it lapses. */
  deadlines: readonly number[];
}

/**
 * Skips a full supervision observation only when it would repeat the last one. The last cycle
 * must have found its source unchanged, and since then no hint, event, stamped input or deadline
 * may have changed. A skipped wake-up still audits the history tail.
 */
export class SupervisionObservationGate {
  private settled: SettledObservation | null = null;
  private changed = true;

  constructor(
    private readonly inputs: SupervisionObservationInputs,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a change hint; the next wake-up observes the full source. */
  invalidate(): void {
    this.changed = true;
  }

  async run(
    cycle: () => Promise<OutcomeSupervisionCycleResult>,
  ): Promise<OutcomeSupervisionCycleResult> {
    const settled = this.settled;
    if (settled !== null && (await this.unchangedSince(settled)))
      return { disposition: settled.disposition, report: null };
    this.settled = null;
    // A hint during the cycle sets this again, so the next wake-up observes once more.
    this.changed = false;
    const baseline = await this.baseline();
    const observedAt = this.now();
    let result: OutcomeSupervisionCycleResult;
    try {
      result = await cycle();
    } catch (error) {
      this.changed = true;
      throw error;
    }
    if (
      baseline !== null &&
      result.report === null &&
      (result.disposition === "idle" || result.disposition === "blocked")
    )
      this.settled = {
        disposition: result.disposition,
        ...baseline,
        observedAt,
        deadlines: this.inputs
          .deadlines()
          .filter((deadline): deadline is number => deadline !== null && deadline > observedAt),
      };
    return result;
  }

  /** Inputs read before a cycle; one that cannot be stamped only prevents a later skip. */
  private async baseline(): Promise<{ head: string; stamp: string } | null> {
    try {
      const head = headKey(this.inputs.head());
      const stamp = await stampInputs(await this.inputs.paths());
      return stamp === null ? null : { head, stamp };
    } catch {
      return null;
    }
  }

  private async unchangedSince(settled: SettledObservation): Promise<boolean> {
    const now = this.now();
    if (
      this.changed ||
      !Number.isFinite(now) ||
      now < settled.observedAt ||
      now - settled.observedAt >= FULL_OBSERVATION_INTERVAL_MS ||
      [...settled.deadlines, ...this.inputs.deadlines()].some(
        (deadline) => deadline !== null && deadline <= now,
      )
    )
      return false;
    try {
      await this.inputs.auditHistory();
      return (
        headKey(this.inputs.head()) === settled.head &&
        (await stampInputs(await this.inputs.paths())) === settled.stamp &&
        !this.changed
      );
    } catch {
      // The full observation reports whatever made the cheap check fail.
      return false;
    }
  }
}

function headKey(head: { seq: number; eventHash: string } | null): string {
  return head === null ? "empty" : `${head.seq}:${head.eventHash}`;
}

/** Identity of every input entry, or null when the inputs exceed the stamped bound. */
async function stampInputs(paths: SupervisionObservationPaths): Promise<string | null> {
  const entries: string[] = [];
  for (const file of paths.files) entries.push(`${file}\0${await identity(file)}`);
  for (const tree of paths.trees) {
    const pending = [tree];
    while (pending.length > 0) {
      const path = pending.pop()!;
      const observed = await identity(path);
      entries.push(`${path}\0${observed}`);
      if (entries.length > MAXIMUM_STAMPED_ENTRIES) return null;
      if (!observed.startsWith("d:")) continue;
      for (const name of (await readdir(path)).sort().reverse()) pending.push(resolve(path, name));
    }
  }
  return createHash("sha256").update(entries.join("\n")).digest("hex");
}

async function identity(path: string): Promise<string> {
  try {
    const info = await lstat(path, { bigint: true });
    const kind = info.isDirectory() ? "d" : info.isFile() ? "f" : info.isSymbolicLink() ? "l" : "o";
    return `${kind}:${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    throw error;
  }
}
