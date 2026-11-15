import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";

import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import type { fixture } from "./fixture.js";
import type { ConvergenceSourceObservation } from "../src/source-observation.js";
import {
  durableEffectState,
  durableStateChanges,
  fenceRefusal,
  latestEventSeq,
  unexemptEventsAfter,
  type FenceRefusal,
} from "./durable-effect-state.js";
import { fenceRefusalLog } from "./fence-refusal-recorder.js";
import { lyingSourceObservation } from "./lying-source-observation.js";

export type Fixture = Awaited<ReturnType<typeof fixture>>;

/**
 * Drives a scenario with a session whose validation never notices another writer. A developer edit
 * lands at the first observation of each selected site and stays:
 *
 * - `exact`: right before an exact fence, the latest moment before its effect.
 * - `decision`: at a decision check the session answers "unchanged". Until the next exact fence,
 *   no durable state may change and no event outside the census exemptions may be appended.
 *
 * Every edit must reach an exact fence, and that very fence must refuse with
 * `source_bytes_changed`: the refusal's stack names it. Callers mock `../src/failure.js` with
 * `recordingFailureModule` so refusals are recorded as they are raised. Verification evidence refuses through its
 * stage receipt instead. Between the refusing fence and the next observation, no durable state may
 * change and no event outside the census exemptions may be appended.
 */
export async function sweepSourceFences(input: {
  f: Fixture;
  mutatedPath: string;
  cycles: number;
  at: "exact" | "decision";
  inject(site: string): boolean;
  done(f: Fixture): Promise<boolean>;
  /** One worker cycle; replaced only by the harness's own tests. */
  run?: (observation: ConvergenceSourceObservation) => Promise<unknown>;
}) {
  const { f } = input;
  const mutated = resolve(f.root, input.mutatedPath);
  const state = () => durableEffectState(f.root, input.mutatedPath);
  const run =
    input.run ??
    ((observation: ConvergenceSourceObservation) =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `lying-${Date.now()}`,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        sourceObservation: observation,
      }));
  const injected: string[] = [];
  const unfenced: string[] = [];
  const violations: string[] = [];
  const edit = (site: string) => {
    injected.push(site);
    appendFileSync(mutated, `// concurrent developer edit ${injected.length}\n`);
  };
  // An edit made at a decision check, until the next exact fence observes it.
  let armed: { site: string; state: Record<string, unknown>; seq: number } | null = null;
  // An exact fence that observed an edit, until the next observation shows what followed it.
  let pending: {
    label: string;
    state: Record<string, unknown>;
    seq: number;
    evidence: boolean;
  } | null = null;
  // Fences that observed an edit during the current cycle, each owed its own refusal.
  let fenced: { label: string; site: string; evidence: boolean }[] = [];
  const fence = (label: string, site: string) => {
    const evidence = site.startsWith("stage-verification.ts");
    fenced.push({ label, site, evidence });
    pending = { label, state: state(), seq: latestEventSeq(f.events), evidence };
  };
  const settlePending = (kind: string) => {
    if (armed !== null && kind === "note_change") {
      violations.push(`${armed.site}: an effect ran with no exact fence after the edit`);
      armed = null;
    }
    if (pending === null) return;
    const settled = pending;
    pending = null;
    // Verification evidence is taken after its effect wrote; its stage receipt refuses instead.
    if (settled.evidence) return;
    if (kind === "note_change") violations.push(`${settled.label}: an effect ran after the edit`);
    for (const change of durableStateChanges(settled.state, state()))
      violations.push(`${settled.label}: ${change} after the refusing fence`);
    for (const type of unexemptEventsAfter(f.events, settled.seq))
      violations.push(`${settled.label}: event ${type} after the refusing fence`);
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
        const label = `${armed.site} -> ${site}`;
        armed = null;
        fence(label, site);
        return;
      }
      if (input.at !== "exact" || injected.includes(site) || !input.inject(site)) return;
      edit(site);
      fence(site, site);
    },
  });
  for (let i = 0; i < input.cycles; i++) {
    const injectedBefore = injected.length;
    const logged = fenceRefusalLog.length;
    fenced = [];
    try {
      await run(observation);
    } catch (error) {
      expect((error as { code?: string }).code).toBe("source_bytes_changed");
    }
    // Each fence that saw an edit must have refused itself; a later decision check that refused
    // instead is no evidence for the fence.
    const refusals: FenceRefusal[] = fenceRefusalLog.slice(logged).map(fenceRefusal);
    for (const owed of fenced) {
      const file = (site: string) => site.split(":")[0];
      const index = refusals.findIndex((refusal) =>
        owed.evidence
          ? refusal.kind === "effect_sources" || refusal.kind === "exact"
          : refusal.site === owed.site
            ? refusal.kind === "exact"
            : // A fence that compares through the effect check, such as the settled-output
              // staging fence, raises its refusal a statement away from its capture.
              refusal.kind === "effect_sources" && file(refusal.site) === file(owed.site),
      );
      if (index === -1)
        violations.push(`${owed.label}: no refusal by this fence (${JSON.stringify(refusals)})`);
      else refusals.splice(index, 1);
    }
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
