import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import type { fixture } from "./fixture.js";
import { effectObservableState, lyingSourceObservation } from "./lying-source-observation.js";

export type Fixture = Awaited<ReturnType<typeof fixture>>;

function refusals(f: Fixture): number {
  let count = 0;
  let afterSeq = 0;
  for (;;) {
    const page = f.events.list({
      afterSeq,
      limit: 1000,
      types: ["repository.knowledge.stage.recorded"],
    });
    for (const event of page) {
      const payload = event.payload as { state?: string; failureCode?: string };
      if (payload.state === "stale" && payload.failureCode === "source_bytes_changed") count += 1;
    }
    if (page.length < 1000) return count;
    afterSeq = page.at(-1)!.seq;
  }
}

/**
 * Drives a scenario with a session whose validation never notices another writer. A developer edit
 * lands at the first observation of each selected site and stays:
 *
 * - `exact`: right before an exact fence, the latest moment before its effect.
 * - `decision`: at a decision check the session answers "unchanged". No repository effect may
 *   follow before the next exact fence, which must refuse.
 *
 * Each edit must end in `source_bytes_changed`, and no effect may act on the bytes it made stale.
 */
export async function sweepSourceFences(input: {
  f: Fixture;
  mutatedPath: string;
  cycles: number;
  at: "exact" | "decision";
  inject(site: string): boolean;
  done(f: Fixture): Promise<boolean>;
}) {
  const { f } = input;
  const mutated = resolve(f.root, input.mutatedPath);
  const state = () => effectObservableState(f.root, input.mutatedPath);
  const injected: string[] = [];
  const violations: string[] = [];
  const edit = (site: string) => {
    injected.push(site);
    appendFileSync(mutated, `// concurrent developer edit ${injected.length}\n`);
  };
  // An edit made at a decision check, until the next exact fence observes it.
  let armed: { site: string; state: string } | null = null;
  // An exact fence that observed an edit, until the next observation shows what followed it.
  let pending: { site: string; state: string; evidence: boolean } | null = null;
  const settlePending = (kind: string) => {
    if (armed !== null && kind === "note_change") {
      violations.push(`${armed.site}: an effect ran with no exact fence after the edit`);
      armed = null;
    }
    if (pending === null) return;
    const settled = pending;
    pending = null;
    // Verification evidence is taken after its effect wrote; only the refusal below applies.
    if (settled.evidence) return;
    if (kind === "note_change") violations.push(`${settled.site}: an effect ran after the edit`);
    else if (state() !== settled.state)
      violations.push(`${settled.site}: repository effect state changed after the edit`);
  };
  const observation = lyingSourceObservation(f.root, {
    onObservation: (kind) => settlePending(kind),
    beforeCurrent: (site) => {
      if (input.at !== "decision" || armed !== null || pending !== null) return;
      if (injected.includes(site) || !input.inject(site)) return;
      edit(site);
      armed = { site, state: state() };
    },
    beforeExact: (site) => {
      if (armed !== null) {
        if (state() !== armed.state)
          violations.push(`${armed.site}: repository effect state changed before ${site}`);
        pending = {
          site: `${armed.site} -> ${site}`,
          state: state(),
          evidence: site.startsWith("stage-verification.ts"),
        };
        armed = null;
        return;
      }
      if (input.at !== "exact" || injected.includes(site) || !input.inject(site)) return;
      edit(site);
      pending = { site, state: state(), evidence: site.startsWith("stage-verification.ts") };
    },
  });
  let thrown = 0;
  for (let i = 0; i < input.cycles; i++) {
    const injectedBefore = injected.length;
    try {
      await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `lying-${i}`,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        sourceObservation: observation,
      });
    } catch (error) {
      expect((error as { code?: string }).code).toBe("source_bytes_changed");
      thrown += 1;
    }
    if (injected.length === injectedBefore && (await input.done(f))) break;
  }
  settlePending("end");
  // Every edit was refused. A decision-check edit can wait for the next cycle's first fence.
  expect(refusals(f) + thrown, JSON.stringify(injected)).toBeGreaterThanOrEqual(injected.length);
  if (armed !== null && state() !== (armed as { state: string }).state)
    violations.push(`${(armed as { site: string }).site}: an effect ran after the edit`);
  return { injected, violations, trace: observation.trace };
}
