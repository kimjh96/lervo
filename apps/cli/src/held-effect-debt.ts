import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { HeldEffectAttentionItemV1 } from "@lervo/application-contract";
import { resolveProjectPaths } from "@lervo/project";

/**
 * ADR-0561 Lervo debt for a foreground effect Lervo held instead of applying: an upgrade stage
 * whose cross-check disagreed or could not run, or a capability package whose stronger check
 * disagreed. It is Lervo's own debt with its age and reason, never owner work.
 */
export type HeldEffectKind =
  "upgrade_knowledge" | "upgrade_terminal_integration" | "capability_install";

export type HeldEffectReason =
  | "cross_check_disagreement_repeated"
  | "stronger_check_disagreement"
  | "cross_check_unavailable"
  | "verification_failed";

export interface HeldEffect {
  effect: HeldEffectKind;
  /** A bounded identifier of what is held: a plan ID or a capability coordinate. */
  subject: string;
  reasonCode: HeldEffectReason;
  since: string;
  lastAttemptAt: string;
  attempts: number;
}

interface HeldEffectState {
  schemaVersion: 1;
  held: HeldEffect[];
}

const MAXIMUM_HELD_EFFECTS = 32;

function statePath(repositoryRoot: string): string {
  return resolve(resolveProjectPaths(repositoryRoot).data, "held-effects.json");
}

/** Every held effect; an absent or unreadable record holds none. */
export async function readHeldEffects(repositoryRoot: string): Promise<HeldEffect[]> {
  try {
    const value = JSON.parse(await readFile(statePath(repositoryRoot), "utf8")) as HeldEffectState;
    return value.schemaVersion === 1 && Array.isArray(value.held) ? value.held : [];
  } catch {
    return [];
  }
}

async function writeHeldEffects(repositoryRoot: string, held: HeldEffect[]): Promise<void> {
  const path = statePath(repositoryRoot);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const value: HeldEffectState = { schemaVersion: 1, held: held.slice(-MAXIMUM_HELD_EFFECTS) };
  await writeFile(`${path}.next`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.next`, path);
}

/** Records or refreshes a held effect; its age runs from the first time it was held. */
/**
 * Why an exact upgrade knowledge plan stays held, or null when it is tried again. A rejected exact
 * plan regenerates identically, so it stays held until its bytes change; a plan no session could
 * check waits until a provider is admitted.
 */
export async function heldUpgradeKnowledgeReason(
  repositoryRoot: string,
  planId: string,
  providerAdmitted: () => Promise<boolean>,
): Promise<HeldEffectReason | null> {
  const held = (await readHeldEffects(repositoryRoot)).find(
    (item) => item.effect === "upgrade_knowledge" && item.subject === planId,
  );
  if (held?.reasonCode === "cross_check_disagreement_repeated") return held.reasonCode;
  return held?.reasonCode === "cross_check_unavailable" && !(await providerAdmitted())
    ? held.reasonCode
    : null;
}

export async function holdEffect(input: {
  repositoryRoot: string;
  effect: HeldEffectKind;
  subject: string;
  reasonCode: HeldEffectReason;
  now?: Date;
}): Promise<HeldEffect> {
  const now = (input.now ?? new Date()).toISOString();
  const held = await readHeldEffects(input.repositoryRoot);
  const prior = held.find((item) => item.effect === input.effect && item.subject === input.subject);
  const next: HeldEffect = {
    effect: input.effect,
    subject: input.subject.slice(0, 200),
    reasonCode: input.reasonCode,
    since: prior?.since ?? now,
    lastAttemptAt: now,
    attempts: (prior?.attempts ?? 0) + 1,
  };
  await writeHeldEffects(input.repositoryRoot, [...held.filter((item) => item !== prior), next]);
  return next;
}

/** Clears every held record of one effect once it applied or no longer applies. */
export async function releaseHeldEffects(
  repositoryRoot: string,
  effect: HeldEffectKind,
  keep: (item: HeldEffect) => boolean = () => false,
): Promise<void> {
  const held = await readHeldEffects(repositoryRoot);
  const remaining = held.filter((item) => item.effect !== effect || keep(item));
  if (remaining.length !== held.length) await writeHeldEffects(repositoryRoot, remaining);
}

const RETRY: Record<HeldEffectKind, string> = {
  upgrade_knowledge: "lervo upgrade --apply",
  upgrade_terminal_integration: "lervo upgrade --apply",
  capability_install: "lervo capability install --apply",
};

/** The operating attention items of held effects: Lervo debt with its age, never owner work. */
export function heldEffectAttentionItems(held: readonly HeldEffect[]): HeldEffectAttentionItemV1[] {
  return held.map((item) => ({
    schemaVersion: 1,
    kind: "held_effect",
    itemId: `held_effect_${createHash("sha256")
      .update(`${item.effect}\0${item.subject}`)
      .digest("hex")
      .slice(0, 24)}`,
    state: "lervo_debt",
    effect: item.effect,
    subject: item.subject,
    reasonCode: item.reasonCode,
    attempts: item.attempts,
    since: item.since,
    actionOwner: "agent",
    requiresUserAction: false,
    blocking: false,
    instruction: `Lervo debt: Lervo held ${item.effect} ${item.subject} (${item.reasonCode}) since ${item.since} and retries it with ${RETRY[item.effect]}; nothing waits for the owner.`,
  }));
}
