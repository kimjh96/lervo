import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createNodeWorkstreamLocalPort } from "@lervo/node-runtime";
import { openProjectStorage } from "@lervo/project-storage";
import { readOwnerOnlyText } from "@lervo/runtime-security";
import {
  AuthenticatedHubHttpTransport,
  reconcileDivergentWorkstream,
  type WorkstreamReconciliationNotice,
  restoreReconciledWorkstreamHead,
  runWorkstreamReplicationCycle,
} from "@lervo/sync";
import { createProjectRegistrationRequest } from "@lervo/sync-contract";
import type { CliIo } from "./types.js";
import { registeredNodeHubCoordinates } from "./knowledge-node-hub-coordinates.js";
import { noticeEffect } from "./effect-notice.js";

/** ADR-0561: a reconciliation or restore reports its notice through the learned notice. */
function noticeReconciliation(
  root: string,
  snapshotContentHash: string,
  notice: WorkstreamReconciliationNotice,
): Promise<void> {
  return noticeEffect({
    repositoryRoot: root,
    effect: notice.effect,
    subject: snapshotContentHash,
    targets: notice.targets,
    reason: notice.reason,
    reviewers: notice.crossCheck.reviewers,
    verdict: notice.crossCheck.verdict,
    undo: notice.undo,
  });
}

export const workstreamHubUsage = [
  "  lervo workstream sync [--root <path>] [--hub-config <path>] [--json]",
  "  lervo workstream reconcile [--restore <snapshot-hash>] [--root <path>] [--hub-config <path>] [--json]",
].join("\n");

/** ADR-0561 removed the owner's choice of head; each removed option names what replaced it. */
const REMOVED_RECONCILE_CHOICE =
  "--keep, --apply, and --write were removed: lervo workstream reconcile keeps the newest valid head and preserves the other on the Hub; restore it with lervo workstream reconcile --restore <snapshot-hash>.";

async function hubCoordinates(root: string, configPath?: string) {
  if (configPath === undefined) {
    const registered = await registeredNodeHubCoordinates(root);
    if (registered !== null) return registered;
  }
  const path = resolve(root, configPath ?? ".lervo/state/knowledge/convergence-owner-host.json");
  const value = JSON.parse(await readOwnerOnlyText(path, 1024 * 1024)) as {
    hub?: Record<string, unknown>;
    coordination?: { mode?: unknown; hub?: Record<string, unknown> };
  };
  const hub =
    value.hub ?? (value.coordination?.mode === "hub" ? value.coordination.hub : undefined);
  if (
    hub === undefined ||
    ["baseUrl", "bearerTokenFile", "destinationId", "hubIdentityHash"].some(
      (key) => typeof hub[key] !== "string",
    )
  )
    throw new Error("A verified Node or convergence-owner Hub configuration is required.");
  return {
    baseUrl: hub.baseUrl as string,
    bearerTokenFile: resolve(path, "..", hub.bearerTokenFile as string),
    destinationId: hub.destinationId as string,
    hubIdentityHash: hub.hubIdentityHash as string,
  };
}

/** Checkpoint transport for CLI-only hosts; a divergence keeps the newest head without the owner. */
export async function runWorkstreamHubCommand(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: args.slice(1),
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      "hub-config": { type: "string" },
      json: { type: "boolean" },
      restore: { type: "string" },
      keep: { type: "string" },
      apply: { type: "string" },
      write: { type: "boolean" },
    },
  });
  if (
    parsed.values.keep !== undefined ||
    parsed.values.apply !== undefined ||
    parsed.values.write !== undefined
  )
    throw new Error(REMOVED_RECONCILE_CHOICE);
  const reconcile = args[0] === "reconcile";
  if (!reconcile && parsed.values.restore !== undefined)
    throw new Error("Sync does not accept reconciliation options.");
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  const hub = await hubCoordinates(root, parsed.values["hub-config"]);
  const storage = await openProjectStorage(root);
  try {
    const registration = createProjectRegistrationRequest({
      manifest: storage.manifest,
      destinationId: hub.destinationId,
      requestedAt: new Date().toISOString(),
    });
    const transport = new AuthenticatedHubHttpTransport({
      ...hub,
      bearerToken: (await readOwnerOnlyText(hub.bearerTokenFile, 16 * 1024)).trim(),
      expectedHubIdentityHash: hub.hubIdentityHash,
      target: {
        projectId: storage.manifest.projectId,
        projectIdentityHash: registration.projectIdentityHash,
      },
    });
    const cycle = {
      local: createNodeWorkstreamLocalPort(storage),
      transport,
      registration,
      destinationId: hub.destinationId,
      expectedPeerIdentityHash: hub.hubIdentityHash,
    };
    const output = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
    const synchronized = await runWorkstreamReplicationCycle(cycle);
    if (!reconcile) {
      output({ schemaVersion: 1, ...synchronized });
      return synchronized.status === "divergent" ? 1 : 0;
    }
    if (parsed.values.restore !== undefined) {
      const restored = await restoreReconciledWorkstreamHead({
        ...cycle,
        snapshotContentHash: parsed.values.restore,
        now: new Date().toISOString(),
      });
      await noticeReconciliation(root, restored.snapshotContentHash, restored.notice);
      output({ schemaVersion: 1, status: "restored", ...restored });
      return 0;
    }
    const result = await reconcileDivergentWorkstream(cycle);
    if (result.status === "not_divergent") {
      output({ schemaVersion: 1, status: "current", sync: synchronized });
      return 0;
    }
    if (result.status === "reconciled")
      await noticeReconciliation(root, result.snapshotContentHash, result.notice);
    output({ schemaVersion: 1, ...result });
    return result.status === "reconciled" ? 0 : 1;
  } finally {
    await storage.close();
  }
}
