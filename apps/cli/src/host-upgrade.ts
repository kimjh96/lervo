import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { CommandFailure } from "./command-error-output.js";
import {
  inspectHostLinks,
  packageLinkTargets,
  readActivationJournal,
  readHostLinks,
  recordActivation,
  settleActivation,
  switchHostLinks,
  withHostUpgradeLock,
  type HostActivationRecord,
  type HostLinkChange,
  type HostLinkState,
} from "./host-cli-activation.js";
import {
  installedPackageRoot,
  installReleasePackage,
  releaseInstallDirectory,
  type HostCliInstaller,
} from "./host-cli-install.js";
import { intakeVerifiedRelease, readPublishedRelease } from "./host-release-intake.js";
import {
  activationReferences,
  pruneHostReleases,
  referencedReleaseDirectories,
} from "./host-release-retention.js";
import type { HostReleaseSource } from "./host-release-source.js";
import { HOST_CLI_LINKS, type HostUpgradeLayout } from "./host-upgrade-layout.js";

/** Runs an installed executable with `--version` and returns its standard output. */
export type HostCliProbe = (executable: string) => Promise<string>;

export interface HostUpgradeDependencies {
  layout: HostUpgradeLayout;
  installer: HostCliInstaller;
  probe: HostCliProbe;
  now: () => Date;
  newActivationId: () => string;
  /** The install root ADR-0488's `current` pointer names, which pruning must keep. */
  readCliPointer: () => Promise<string | null>;
}

export interface HostReleasePlan {
  status: "ready" | "current";
  repository: string;
  tag: string;
  version: string;
  commit: string;
  tree: string;
  installDirectory: string;
  links: HostLinkChange[];
}

export type HostUpgradeResult =
  | (HostReleasePlan & { status: "current"; reusedInstall: boolean })
  | {
      status: "activated";
      activation: HostActivationRecord;
      reusedInstall: boolean;
      pruned: string[];
    };

export interface HostRollbackResult {
  status: "ready" | "rolled_back";
  rolledBackActivationId: string;
  links: HostLinkChange[];
  activation?: HostActivationRecord;
}

const probeTimeoutMilliseconds = 60_000;

/**
 * Runs the link itself, as a user's shell would: through its `#!/usr/bin/env node` line, the
 * executable bit, and the `node` on PATH, so a too-old `node` or a lost executable bit fails here.
 */
export const probeInstalledCli: HostCliProbe = (executable) =>
  new Promise((resolvePromise, reject) => {
    execFile(
      executable,
      ["--version"],
      { timeout: probeTimeoutMilliseconds, encoding: "utf8" },
      (error, stdout) => (error === null ? resolvePromise(stdout) : reject(error)),
    );
  });

export function newHostActivationId(): string {
  return `hact_${randomBytes(12).toString("hex")}`;
}

function linkChanges(
  layout: HostUpgradeLayout,
  current: ReadonlyMap<string, string | null>,
  targets: ReadonlyMap<string, string | null>,
): HostLinkChange[] {
  return HOST_CLI_LINKS.map(({ name }) => ({
    name,
    path: resolve(layout.binDirectory, name),
    previous: current.get(name) ?? null,
    current: targets.get(name) ?? null,
  }));
}

const unchanged = (changes: HostLinkChange[]) =>
  changes.every((change) => change.previous === change.current);
const targetsOf = (changes: HostLinkChange[], side: "previous" | "current") =>
  new Map(changes.map((change) => [change.name, change[side]]));

/** Read-only: what applying `tag` would install and which links it would switch. */
export async function planReleaseUpgrade(
  source: HostReleaseSource,
  tag: string,
  dependencies: Pick<HostUpgradeDependencies, "layout">,
): Promise<HostReleasePlan> {
  const { layout } = dependencies;
  const { version, commit } = await readPublishedRelease(source, tag);
  const installDirectory = releaseInstallDirectory(layout, { version, commit: commit.sha });
  // Activation names the package's physical root, which exists only after the install; before
  // that, the plan names the stable path pnpm links it at.
  const root =
    (await installedPackageRoot(installDirectory)) ??
    resolve(installDirectory, "node_modules", "@lervo", "cli");
  const links = linkChanges(layout, await readHostLinks(layout), packageLinkTargets(root));
  return {
    status: unchanged(links) ? "current" : "ready",
    repository: source.repository,
    tag,
    version,
    commit: commit.sha,
    tree: commit.tree,
    installDirectory,
    links,
  };
}

/** A null expectation means no `lervo` link remains to probe, as after undoing a first install. */
async function linksHealthy(dependencies: HostUpgradeDependencies, expected: RegExp | null) {
  if (expected === null) return true;
  const executable = resolve(dependencies.layout.binDirectory, "lervo");
  const output = await dependencies.probe(executable).catch(() => null);
  return output !== null && expected.test(output.trim());
}

function healthFailure(layout: HostUpgradeLayout): CommandFailure {
  const executable = resolve(layout.binDirectory, "lervo");
  return new CommandFailure(
    "host_upgrade_health_failed",
    `${executable} failed its health check after the switch; the previous links were restored.`,
    { executable },
  );
}

/**
 * Switches links under a `pending` record, health-checks them, and settles the record: `active`
 * on success, or `restored` after putting the previous links back.
 */
async function activateLinks(
  dependencies: HostUpgradeDependencies,
  record: HostActivationRecord,
  expected: RegExp | null,
): Promise<HostActivationRecord[]> {
  const { layout } = dependencies;
  await recordActivation(layout, record);
  const previous = targetsOf(record.links, "previous");
  try {
    await switchHostLinks(layout, targetsOf(record.links, "current"), previous);
  } catch (error) {
    await settleActivation(layout, record.activationId, "restored");
    throw error;
  }
  if (!(await linksHealthy(dependencies, expected))) {
    await switchHostLinks(layout, previous, previous);
    await settleActivation(layout, record.activationId, "restored");
    throw healthFailure(layout);
  }
  return settleActivation(layout, record.activationId, "active");
}

/** Downloads, verifies, installs, switches, health-checks, and records one published release. */
export async function applyReleaseUpgrade(
  source: HostReleaseSource,
  tag: string,
  dependencies: HostUpgradeDependencies,
): Promise<HostUpgradeResult> {
  const { layout } = dependencies;
  return withHostUpgradeLock(layout, async () => {
    const { commit } = await readPublishedRelease(source, tag);
    const { release, downloadDirectory } = await intakeVerifiedRelease(source, tag, layout, commit);
    const install = await installReleasePackage({
      layout,
      release,
      tarballPath: resolve(downloadDirectory, release.tarballName),
      installer: dependencies.installer,
    });
    const links = linkChanges(
      layout,
      await readHostLinks(layout),
      packageLinkTargets(install.packageRoot),
    );
    if (unchanged(links))
      return {
        status: "current",
        repository: source.repository,
        tag,
        version: release.version,
        commit: release.commit,
        tree: release.tree,
        installDirectory: install.installDirectory,
        links,
        reusedInstall: install.reused,
      };
    const record: HostActivationRecord = {
      activationId: dependencies.newActivationId(),
      kind: "release",
      outcome: "pending",
      activatedAt: dependencies.now().toISOString(),
      links,
      release: {
        repository: source.repository,
        tag,
        version: release.version,
        commit: release.commit,
        tree: release.tree,
        tarballSha256: release.tarballSha256,
        installDirectory: install.installDirectory,
        downloadDirectory,
      },
    };
    const expected = new RegExp(`^lervo ${release.version.replaceAll(".", "\\.")}$`, "u");
    const journal = await activateLinks(dependencies, record, expected);
    const referenced = await referencedReleaseDirectories(layout, [
      ...(await readHostLinks(layout)).values(),
      await dependencies.readCliPointer(),
      ...activationReferences(journal),
    ]);
    const pruned = await pruneHostReleases(layout, referenced);
    return {
      status: "activated",
      activation: journal.find((entry) => entry.activationId === record.activationId) ?? record,
      reusedInstall: install.reused,
      pruned,
    };
  });
}

/**
 * Restores exactly the links one activation replaced. It refuses when any link has moved since,
 * because restoring then would silently undo a later activation; roll that one back first.
 */
export async function rollbackActivation(
  activationId: string,
  apply: boolean,
  dependencies: HostUpgradeDependencies,
): Promise<HostRollbackResult> {
  const { layout } = dependencies;
  const run = async (): Promise<HostRollbackResult> => {
    const target = (await readActivationJournal(layout)).find(
      (candidate) => candidate.activationId === activationId,
    );
    if (target === undefined)
      throw new CommandFailure(
        "host_upgrade_activation_unknown",
        `No retained activation ${activationId} exists on this host; see lervo host upgrade --status.`,
        { activationId },
      );
    const current = await readHostLinks(layout);
    for (const change of target.links)
      if ((current.get(change.name) ?? null) !== change.current)
        throw new CommandFailure(
          "host_upgrade_rollback_superseded",
          `${change.path} changed after activation ${activationId}; roll back the newer activation first.`,
          { activationId, path: change.path },
        );
    const links = target.links.map((change) => ({
      ...change,
      previous: change.current,
      current: change.previous,
    }));
    if (!apply) return { status: "ready", rolledBackActivationId: activationId, links };
    const record: HostActivationRecord = {
      activationId: dependencies.newActivationId(),
      kind: "rollback",
      outcome: "pending",
      activatedAt: dependencies.now().toISOString(),
      links,
      rolledBackActivationId: activationId,
    };
    const restoresLervo = links.some((link) => link.name === "lervo" && link.current !== null);
    const journal = await activateLinks(
      dependencies,
      record,
      restoresLervo ? /^lervo \d+\.\d+\.\d+$/u : null,
    );
    return {
      status: "rolled_back",
      rolledBackActivationId: activationId,
      links,
      activation: journal.find((entry) => entry.activationId === record.activationId) ?? record,
    };
  };
  return apply ? withHostUpgradeLock(layout, run) : run();
}

export async function hostUpgradeStatus(layout: HostUpgradeLayout): Promise<{
  links: HostLinkState[];
  activations: HostActivationRecord[];
}> {
  return {
    links: await inspectHostLinks(layout),
    activations: await readActivationJournal(layout),
  };
}
