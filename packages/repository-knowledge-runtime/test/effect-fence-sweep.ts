import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import type { fixture } from "./fixture.js";
import {
  durableEffectState,
  durableStateChanges,
  latestEventSeq,
  unexemptEventsAfter,
} from "./durable-effect-state.js";
import { lyingSourceObservation } from "./lying-source-observation.js";

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
 * - `decision`: at a decision check the session answers "unchanged". Until the next exact fence,
 *   no durable state may change and no event outside the census exemptions may be appended.
 *
 * Every edit must reach an exact fence, that fence must refuse with `source_bytes_changed`, and
 * no durable state may change between the refusal and the next observation.
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
  const state = () => durableEffectState(f.root, input.mutatedPath);
  const injected: string[] = [];
  const unfenced: string[] = [];
  const violations: string[] = [];
  let thrown = 0;
  let fencedThisCycle = 0;
  const edit = (site: string) => {
    injected.push(site);
    appendFileSync(mutated, `// concurrent developer edit ${injected.length}\n`);
  };
  // An edit made at a decision check, until the next exact fence observes it.
  let armed: { site: string; state: Record<string, unknown>; seq: number } | null = null;
  // An exact fence that observed an edit, until the next observation shows what followed it.
  let pending: { site: string; state: Record<string, unknown>; evidence: boolean } | null = null;
  const fence = (site: string) => {
    fencedThisCycle += 1;
    pending = { site, state: state(), evidence: site.includes("stage-verification.ts") };
  };
  const settlePending = (kind: string) => {
    if (armed !== null && kind === "note_change") {
      violations.push(`${armed.site}: an effect ran with no exact fence after the edit`);
      armed = null;
    }
    if (pending === null) return;
    const settled = pending;
    pending = null;
    // Verification evidence is taken after its effect wrote; only the refusal applies.
    if (settled.evidence) return;
    if (kind === "note_change") violations.push(`${settled.site}: an effect ran after the edit`);
    for (const change of durableStateChanges(settled.state, state()))
      violations.push(`${settled.site}: ${change} after the refusing fence`);
  };
  const observation = lyingSourceObservation(f.root, {
    onObservation: (kind) => settlePending(kind),
    beforeCurrent: (site) => {
      if (input.at !== "decision" || armed !== null || pending !== null) return;
      if (injected.includes(site) || !input.inject(site)) return;
      edit(site);
      armed = { site, state: state(), seq: latestEventSeq(f.events) };
    },
    beforeExact: (site) => {
      if (armed !== null) {
        for (const change of durableStateChanges(armed.state, state()))
          violations.push(`${armed.site}: ${change} before ${site}`);
        for (const type of unexemptEventsAfter(f.events, armed.seq))
          violations.push(`${armed.site}: event ${type} before ${site}`);
        const site_ = `${armed.site} -> ${site}`;
        armed = null;
        fence(site_);
        return;
      }
      if (input.at !== "exact" || injected.includes(site) || !input.inject(site)) return;
      edit(site);
      fence(site);
    },
  });
  for (let i = 0; i < input.cycles; i++) {
    const injectedBefore = injected.length;
    const refusedBefore = refusals(f) + thrown;
    fencedThisCycle = 0;
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
    // Each fence that saw an edit refused: decision checks never refuse, they lie.
    if (refusals(f) + thrown - refusedBefore < fencedThisCycle)
      violations.push(
        `cycle ${i}: ${fencedThisCycle} exact fences saw an edit, ${refusals(f) + thrown - refusedBefore} refused`,
      );
    // An edit whose obligation settled without another exact fence, such as a waiting or
    // attention record, wrote nothing durable: check that, count it as unfenced, and let the
    // session answer truthfully again so later obligations can reach their fences.
    const open = armed as { site: string; state: Record<string, unknown>; seq: number } | null;
    if (open !== null) {
      for (const change of durableStateChanges(open.state, state()))
        violations.push(`${open.site}: ${change} with no exact fence after the edit`);
      for (const type of unexemptEventsAfter(f.events, open.seq))
        violations.push(`${open.site}: event ${type} with no exact fence after the edit`);
      unfenced.push(open.site);
      armed = null;
      observation.resync();
    }
    if (injected.length === injectedBefore && (await input.done(f))) break;
  }
  settlePending("end");
  return { injected, unfenced, violations, trace: observation.trace };
}
