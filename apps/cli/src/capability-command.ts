import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  capabilityRoot,
  discoverCapabilityRoot,
  readCapabilityPackage,
  resolveCapabilities,
  writeCapabilityLock,
  createCapabilityMigrationPlan,
  applyCapabilityMigration,
} from "@lervo/capabilities";
import { loadProjectManifest } from "@lervo/project";

import { runCapabilityInstall } from "./capability-install-command.js";
import { effectBackupUndoCommand, sealEffectBackup, takeEffectBackup } from "./effect-backup.js";
import { hasRemovedOption, REMOVED_APPLY_APPROVAL } from "./removed-approval-options.js";
import { runSkillAuthorizationCommand } from "./skill-authorization-command.js";
import type { CliIo, CliServices } from "./types.js";

export const capabilityUsage = `  lervo capability list [--scope <project|user|all>] [--root <path>] [--json]
  lervo capability authorize-skill --skill <skill-id> --reviewer <id> [--apply] [--root <path>] [--json]
  lervo capability authorize-skill --from <plan-json> --apply [--root <path>] [--json]
  lervo capability migrate [--apply] [--root <path>] [--json]
  lervo capability validate --from <package-directory> [--json]
  lervo capability install --from <package-directory> --scope <project|user> [--apply [--provider <codex|claude>] [--executable <path>]] [--root <path>] [--json]
  lervo capability resolve --capability <package-id> [--capability <package-id> ...] --provider <codex|claude> [--root <path>] [--json]`;

export async function runCapabilityCommand(
  args: string[],
  io: CliIo,
  services: Partial<Pick<CliServices, "crossCheckCapability">> = {},
): Promise<number> {
  try {
    if (hasRemovedOption(args, "approval")) throw new Error(REMOVED_APPLY_APPROVAL);
    if (args[0] === "authorize-skill") return await runSkillAuthorizationCommand(args.slice(1), io);
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        scope: { type: "string" },
        from: { type: "string" },
        apply: { type: "boolean" },
        capability: { type: "string", multiple: true },
        provider: { type: "string" },
        executable: { type: "string" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${capabilityUsage}\n`);
      return 0;
    }
    if (parsed.positionals.length !== 1) throw new Error("Specify one capability action.");
    const action = parsed.positionals[0];
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    if (action === "migrate") {
      const plan = await createCapabilityMigrationPlan(repositoryRoot);
      if (!parsed.values.apply) {
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(plan, null, 2)}\n`
            : `Capability migration ${plan.planId}: ${plan.status}\n${plan.items.map((item) => `${item.action} ${item.sourcePath} -> ${item.targetPath}`).join("\n")}\n`,
        );
        return 0;
      }
      // The plan is bound internally: apply plans again and refuses a changed source. Each new
      // package directory is recorded so `lervo state restore` removes it again.
      const created = plan.items
        .filter((item) => item.action === "create")
        .map((item) => resolve(plan.repositoryRoot, item.targetPath));
      const backup =
        created.length === 0
          ? null
          : await takeEffectBackup({
              repositoryRoot,
              effect: "capability_migration",
              reason: `Capability migration ${plan.planId} packages ${created.length} repository skill(s).`,
              createdDirectories: created,
            });
      const result = await applyCapabilityMigration(plan);
      if (backup !== null) await sealEffectBackup(repositoryRoot, backup);
      const undo = backup === null ? null : effectBackupUndoCommand(backup.backupId);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify({ ...result, undo }, null, 2)}\n`
          : `Capability migration completed: ${result.status}.\n${undo === null ? "" : `Undo: ${undo}\n`}`,
      );
      return 0;
    }
    if (action === "list") {
      const requestedScope = parsed.values.scope ?? "all";
      if (!["project", "user", "all"].includes(requestedScope))
        throw new Error("Capability list scope must be project, user, or all.");
      const packages = (
        await Promise.all(
          (["project", "user"] as const)
            .filter((item) => requestedScope === "all" || requestedScope === item)
            .map(async (item) =>
              (await discoverCapabilityRoot(capabilityRoot(repositoryRoot, item), item)).map(
                (entry) => ({
                  capabilityId: entry.manifest.capabilityId,
                  kind: entry.manifest.kind,
                  version: entry.manifest.version,
                  contentHash: entry.manifest.contentHash,
                  scope: item,
                  provenance: entry.manifest.source,
                }),
              ),
            ),
        )
      )
        .flat()
        .sort(
          (a, b) => a.capabilityId.localeCompare(b.capabilityId) || a.scope.localeCompare(b.scope),
        );
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify({ schemaVersion: 1, packages }, null, 2)}\n`
          : packages.length === 0
            ? "No installed capability packages.\n"
            : `${packages.map((item) => `${item.capabilityId}@${item.version} · ${item.kind} · ${item.scope} · ${item.contentHash}`).join("\n")}\n`,
      );
      return 0;
    }
    if (action === "validate") {
      if (parsed.values.from === undefined) throw new Error("Capability validate requires --from.");
      const verified = await readCapabilityPackage(resolve(io.cwd, parsed.values.from));
      const result = {
        schemaVersion: 1,
        valid: true,
        manifest: verified.manifest,
        fileCount: verified.files.length - 1,
      };
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Validated ${verified.manifest.capabilityId}@${verified.manifest.version} (${verified.manifest.contentHash}).\n`,
      );
      return 0;
    }
    if (action === "install")
      return await runCapabilityInstall({
        repositoryRoot,
        io,
        values: parsed.values,
        ...(services.crossCheckCapability === undefined
          ? {}
          : { crossCheckCapability: services.crossCheckCapability }),
      });
    if (action === "resolve") {
      const ids = parsed.values.capability ?? [];
      if (ids.length === 0 || !["codex", "claude"].includes(parsed.values.provider ?? ""))
        throw new Error("Capability resolve requires --capability and --provider.");
      const project = await loadProjectManifest(repositoryRoot);
      const result = await resolveCapabilities({
        repositoryRoot,
        projectId: project.projectId,
        capabilityIds: ids,
        provider: parsed.values.provider!,
        platform: process.platform,
        generatedAt: new Date().toISOString(),
      });
      await writeCapabilityLock(repositoryRoot, result.lock);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify({ schemaVersion: 1, resolved: result.selected, lock: result.lock }, null, 2)}\n`
          : `${result.selected.map((item) => `${item.capabilityId}@${item.version} · resolved, not activated`).join("\n")}\n`,
      );
      return 0;
    }
    throw new Error("The capability action is invalid.");
  } catch (error) {
    io.stderr(
      `Capability command failed: ${error instanceof Error ? error.message : String(error)}\n${capabilityUsage}\n`,
    );
    return 1;
  }
}
