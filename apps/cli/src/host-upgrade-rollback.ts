import { CommandFailure } from "./command-error-output.js";
import {
  readActivationJournal,
  readHostLinks,
  withHostUpgradeLock,
  type HostActivationRecord,
  type HostLinkChange,
} from "./host-cli-activation.js";
import {
  activateLinks,
  isUnfinished,
  reconcilePendingActivations,
  unfinishedRestore,
  type HostCliProbes,
} from "./host-link-activation.js";
import type { HostUpgradeLayout } from "./host-upgrade-layout.js";

export interface HostRollbackResult {
  status: "ready" | "rolled_back";
  rolledBackActivationId: string;
  links: HostLinkChange[];
  activation?: HostActivationRecord;
  reconciledActivations: string[];
}

function superseded(activationId: string, path: string): CommandFailure {
  return new CommandFailure(
    "host_upgrade_rollback_superseded",
    `${path} changed after activation ${activationId}; roll back the newer activation first.`,
    { activationId, path },
  );
}

/**
 * The link changes that undo one record, given where the links are now. A `restored` or
 * `abandoned` record has nothing left to undo: its links already went back or were never its own,
 * and matching links would belong to a later activation of the same targets.
 */
function undoChanges(
  journal: readonly HostActivationRecord[],
  target: HostActivationRecord,
  current: ReadonlyMap<string, string | null>,
): HostLinkChange[] {
  if (target.outcome === "restored" || target.outcome === "abandoned") return [];
  if (target.outcome === "pending") {
    if (!isUnfinished(journal, target)) return [];
    const restore = unfinishedRestore(target, current);
    if (restore === null) throw superseded(target.activationId, target.links[0]?.path ?? "a link");
    return restore;
  }
  for (const change of target.links)
    if ((current.get(change.name) ?? null) !== change.current)
      throw superseded(target.activationId, change.path);
  return target.links.map((change) => ({
    ...change,
    previous: change.current,
    current: change.previous,
  }));
}

/**
 * Restores exactly the links one activation replaced. An `active` record requires every link
 * still at its target, because restoring otherwise would silently undo a later activation. A
 * `pending` record restores only the links still at its target, and only while no later record
 * has settled; a `restored` or `abandoned` record has nothing left to undo. Applying first
 * reconciles pending records left by a crashed run.
 */
export async function rollbackActivation(
  activationId: string,
  apply: boolean,
  dependencies: {
    layout: HostUpgradeLayout;
    probes: HostCliProbes;
    now: () => Date;
    newActivationId: () => string;
  },
): Promise<HostRollbackResult> {
  const { layout } = dependencies;
  const execute = async (): Promise<HostRollbackResult> => {
    const reconciledActivations = apply ? await reconcilePendingActivations(layout) : [];
    const journal = await readActivationJournal(layout);
    const target = journal.find((candidate) => candidate.activationId === activationId);
    if (target === undefined)
      throw new CommandFailure(
        "host_upgrade_activation_unknown",
        `No retained activation ${activationId} exists on this host; see lervo host upgrade --status.`,
        { activationId },
      );
    const links = undoChanges(journal, target, await readHostLinks(layout));
    const base = { rolledBackActivationId: activationId, links, reconciledActivations };
    if (!apply) return { status: "ready", ...base };
    if (links.length === 0) return { status: "rolled_back", ...base };
    const record: HostActivationRecord = {
      activationId: dependencies.newActivationId(),
      kind: "rollback",
      outcome: "pending",
      activatedAt: dependencies.now().toISOString(),
      links,
      rolledBackActivationId: activationId,
    };
    const restoresLervo = links.some((link) => link.name === "lervo" && link.current !== null);
    const settled = await activateLinks(
      layout,
      dependencies.probes,
      record,
      restoresLervo ? /^lervo \d+\.\d+\.\d+$/u : null,
    );
    return {
      status: "rolled_back",
      ...base,
      activation: settled.find((entry) => entry.activationId === record.activationId) ?? record,
    };
  };
  return apply ? withHostUpgradeLock(layout, execute) : execute();
}
