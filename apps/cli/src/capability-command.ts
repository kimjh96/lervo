import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  capabilityRoot,
  discoverCapabilityRoot,
  installCapabilityPackage,
  readCapabilityPackage,
  resolveCapabilities,
  writeCapabilityLock,
  type LocalCapabilityScope,
  createCapabilityMigrationPlan,
  applyCapabilityMigration,
} from "@lervo/capabilities";
import { loadProjectManifest } from "@lervo/project";

import { runSkillAuthorizationCommand } from "./skill-authorization-command.js";
import type { CliIo } from "./types.js";

export const capabilityUsage = `  lervo capability list [--scope <project|user|all>] [--root <path>] [--json]
  lervo capability authorize-skill --skill <skill-id> --reviewer <id> [--root <path>] [--json]
  lervo capability authorize-skill --from <plan-json> --apply --approval <plan-id> [--root <path>] [--json]
  lervo capability migrate [--apply --approval <plan-id>] [--root <path>] [--json]
  lervo capability validate --from <package-directory> [--json]
  lervo capability install --from <package-directory> --scope <project|user> [--apply --approval <plan-hash>] [--root <path>] [--json]
  lervo capability resolve --capability <package-id> [--capability <package-id> ...] --provider <codex|claude> [--root <path>] [--json]`;

function planHash(value: object): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function scope(value: string | undefined): LocalCapabilityScope {
  if (value === "project" || value === "user") return value;
  throw new Error("Capability scope must be project or user.");
}

export async function runCapabilityCommand(args: string[], io: CliIo): Promise<number> {
  try {
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
        approval: { type: "string" },
        capability: { type: "string", multiple: true },
        provider: { type: "string" },
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
      if (parsed.values.approval !== plan.planId)
        throw new Error("--approval must equal the current capability migration plan ID.");
      const result = await applyCapabilityMigration(plan);
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Capability migration completed: ${result.status}.\n`,
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
    if (action === "install") {
      if (parsed.values.from === undefined) throw new Error("Capability install requires --from.");
      const targetScope = scope(parsed.values.scope);
      const verified = await readCapabilityPackage(resolve(io.cwd, parsed.values.from));
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
        secretMaterial: "excluded" as const,
      };
      if (!parsed.values.apply) {
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(plan, null, 2)}\n`
            : `Install plan ${plan.planHash}\n${plan.capabilityId}@${plan.version} -> ${plan.scope}\nRe-run with --apply --approval ${plan.planHash}.\n`,
        );
        return 0;
      }
      if (parsed.values.approval !== plan.planHash)
        throw new Error("--approval must equal the current install plan hash.");
      await installCapabilityPackage({ repositoryRoot, scope: targetScope, package: verified });
      const receipt = {
        schemaVersion: 1,
        operation: "capability.installed",
        planHash: plan.planHash,
        capabilityId: plan.capabilityId,
        version: plan.version,
        contentHash: plan.contentHash,
        scope: targetScope,
      };
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(receipt, null, 2)}\n`
          : `Installed ${plan.capabilityId}@${plan.version} in ${targetScope} scope.\n`,
      );
      return 0;
    }
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
