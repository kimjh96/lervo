import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";

import {
  capabilityRoot,
  installCapabilityPackage,
  readCapabilityPackage,
  type LocalCapabilityScope,
} from "@lervo/capabilities";

import {
  crossCheckCapability,
  strongerCapabilityCrossCheck,
  type CrossCheckCapability,
} from "./capability-install-cross-check.js";
import { CommandFailure } from "./command-error-output.js";
import { effectBackupUndoCommand, sealEffectBackup, takeEffectBackup } from "./effect-backup.js";
import { noticeEffect } from "./effect-notice.js";
import { holdEffect, releaseHeldEffects } from "./held-effect-debt.js";
import type { CliIo } from "./types.js";

function planHash(value: object): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function scope(value: string | undefined): LocalCapabilityScope {
  if (value === "project" || value === "user") return value;
  throw new Error("Capability scope must be project or user.");
}

/**
 * `lervo capability install` (ADR-0210, ADR-0561): prints the content-bound install plan, or with
 * `--apply` installs after the stronger check agrees, records the new package directory as a
 * backup, and prints its undo. A disagreement installs nothing and is held as Lervo debt.
 */
export async function runCapabilityInstall(input: {
  repositoryRoot: string;
  io: CliIo;
  values: {
    from?: string;
    scope?: string;
    apply?: boolean;
    json?: boolean;
    provider?: string;
    executable?: string;
  };
  crossCheckCapability?: CrossCheckCapability;
}): Promise<number> {
  const { repositoryRoot } = input;
  if (input.values.from === undefined) throw new Error("Capability install requires --from.");
  const targetScope = scope(input.values.scope);
  const verified = await readCapabilityPackage(resolve(input.io.cwd, input.values.from));
  const planBody = {
    schemaVersion: 1 as const,
    operation: "capability.install" as const,
    capabilityId: verified.manifest.capabilityId,
    version: verified.manifest.version,
    contentHash: verified.manifest.contentHash,
    kind: verified.manifest.kind,
    scope: targetScope,
  };
  const plan = {
    ...planBody,
    planHash: planHash(planBody),
    requiresApply: true,
    crossCheck: "two_agreeing_independent_sessions" as const,
    secretMaterial: "excluded" as const,
  };
  if (!input.values.apply) {
    input.io.stdout(
      input.values.json
        ? `${JSON.stringify(plan, null, 2)}\n`
        : `Install plan ${plan.planHash}\n${plan.capabilityId}@${plan.version} -> ${plan.scope}\nRe-run with --apply; two independent cross-checks must agree before anything is installed.\n`,
    );
    return 0;
  }
  if (
    input.values.provider !== undefined &&
    input.values.provider !== "codex" &&
    input.values.provider !== "claude"
  )
    throw new Error("--provider must be codex or claude.");
  const subject = `${plan.capabilityId}@${plan.version}`;
  // ADR-0561: every package grants an agent new capability, so the install takes the stronger
  // check: two agreeing independent sessions. A disagreement installs nothing and is held as
  // Lervo debt, never asked of the owner.
  const check = await strongerCapabilityCrossCheck({
    repositoryRoot,
    package: verified,
    ...(input.values.provider === undefined
      ? {}
      : { provider: input.values.provider as "codex" | "claude" }),
    ...(input.values.executable === undefined
      ? {}
      : { executable: resolve(input.io.cwd, input.values.executable) }),
    crossCheck: input.crossCheckCapability ?? crossCheckCapability,
  });
  if (!check.agreed) {
    await holdEffect({
      repositoryRoot,
      effect: "capability_install",
      subject,
      reasonCode: "stronger_check_disagreement",
    });
    const rejected = check.verdicts.at(-1)!;
    throw new CommandFailure(
      "capability_cross_check_disagreed",
      `An independent cross-check (${rejected.reviewer}) disagreed with installing ${subject}, so nothing was installed and Lervo holds it as its own debt: ${rejected.rationale}`,
    );
  }
  const target = resolve(
    capabilityRoot(repositoryRoot, targetScope),
    `${encodeURIComponent(plan.capabilityId)}@${plan.version}`,
  );
  // An identical package already installed is left as it is, with nothing to undo.
  const present = await lstat(target).then(
    () => true,
    () => false,
  );
  const backup = present
    ? null
    : await takeEffectBackup({
        repositoryRoot,
        effect: "capability_install",
        reason: `Installed ${subject} in ${targetScope} scope after two agreeing cross-checks.`,
        createdDirectories: [target],
      });
  await installCapabilityPackage({ repositoryRoot, scope: targetScope, package: verified });
  if (backup !== null) await sealEffectBackup(repositoryRoot, backup);
  await releaseHeldEffects(
    repositoryRoot,
    "capability_install",
    (item) => item.subject !== subject,
  );
  const undo = backup === null ? null : effectBackupUndoCommand(backup.backupId);
  if (backup !== null && undo !== null)
    await noticeEffect({
      repositoryRoot,
      effect: "capability_install",
      subject: backup.backupId,
      targets: [subject],
      reason: `installed ${subject} in ${targetScope} scope`,
      reviewers: check.verdicts.map((item) => item.reviewer),
      verdict: "agree",
      undo,
    });
  const receipt = {
    schemaVersion: 1,
    operation: "capability.installed",
    planHash: plan.planHash,
    capabilityId: plan.capabilityId,
    version: plan.version,
    contentHash: plan.contentHash,
    scope: targetScope,
    crossCheck: check.verdicts.map(({ reviewer, verdict }) => ({ reviewer, verdict })),
    undo,
  };
  input.io.stdout(
    input.values.json
      ? `${JSON.stringify(receipt, null, 2)}\n`
      : `Installed ${plan.capabilityId}@${plan.version} in ${targetScope} scope.\nCross-check: ${check.verdicts.map((item) => item.reviewer).join(" and ")} agreed.\n${undo === null ? "" : `Undo: ${undo}\n`}`,
  );
  return 0;
}
