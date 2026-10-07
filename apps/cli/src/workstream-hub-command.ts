import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createNodeWorkstreamLocalPort } from "@lervo/node-runtime";
import { openProjectStorage } from "@lervo/project-storage";
import { readOwnerOnlyText } from "@lervo/runtime-security";
import {
  AuthenticatedHubHttpTransport,
  planWorkstreamReconciliation,
  readHubWorkstream,
  runWorkstreamReplicationCycle,
} from "@lervo/sync";
import { createProjectRegistrationRequest } from "@lervo/sync-contract";
import type { CliIo } from "./types.js";
import { registeredNodeHubCoordinates } from "./knowledge-node-hub-coordinates.js";

export const workstreamHubUsage = [
  "  lervo workstream sync [--root <path>] [--hub-config <path>] [--json]",
  "  lervo workstream reconcile --keep <local|hub> [--root <path>] [--hub-config <path>] [--apply <plan-id> --write] [--json]",
].join("\n");

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

/** Explicit checkpoint transport for CLI-only hosts; reconciliation always requires an exact plan. */
export async function runWorkstreamHubCommand(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args: args.slice(1),
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" },
      "hub-config": { type: "string" },
      json: { type: "boolean" },
      keep: { type: "string" },
      apply: { type: "string" },
      write: { type: "boolean" },
    },
  });
  const reconcile = args[0] === "reconcile";
  if (reconcile && parsed.values.keep !== "local" && parsed.values.keep !== "hub")
    throw new Error("Reconciliation requires --keep local or --keep hub.");
  if (Boolean(parsed.values.apply) !== Boolean(parsed.values.write))
    throw new Error("Reconciliation apply requires an exact plan ID and --write.");
  if (
    !reconcile &&
    (parsed.values.keep !== undefined || parsed.values.apply !== undefined || parsed.values.write)
  )
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
    const local = createNodeWorkstreamLocalPort(storage);
    const cycle = {
      local,
      transport,
      registration,
      destinationId: hub.destinationId,
      expectedPeerIdentityHash: hub.hubIdentityHash,
    };
    const output = (value: unknown) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
    if (!reconcile) {
      const result = await runWorkstreamReplicationCycle(cycle);
      output({ schemaVersion: 1, ...result });
      return result.status === "divergent" ? 1 : 0;
    }
    const current = (await local.readRevisionChain()).at(-1);
    if (current === undefined)
      throw new Error("A local checkpoint is required for reconciliation.");
    const remote = await readHubWorkstream(cycle);
    const plan = planWorkstreamReconciliation({
      projectId: storage.manifest.projectId,
      local: current,
      remote,
      keep: parsed.values.keep as "local" | "hub",
      now: new Date().toISOString(),
    });
    if (parsed.values.apply === undefined) {
      output({
        schemaVersion: 1,
        status: "review_required",
        planId: plan.planId,
        keep: plan.keep,
        parents: plan.parents,
        successorWorkstreamId: plan.revision.snapshot.workstreamId,
        selectedRevision:
          plan.keep === "local" ? current.snapshot.revision : remote.snapshot!.revision,
      });
      return 0;
    }
    if (parsed.values.apply !== plan.planId) throw new Error("The reconciliation plan is stale.");
    await runWorkstreamReplicationCycle(cycle);
    // Publication may have advanced either side. Revalidate both exact heads and the local selection.
    const observed = await readHubWorkstream(cycle);
    const latest = (await local.readRevisionChain()).at(-1);
    if (
      latest?.snapshotContentHash !== current.snapshotContentHash ||
      observed.heads.length !== 2 ||
      !observed.heads.every((head) =>
        plan.parents.some((parent) => parent.snapshotContentHash === head.snapshotContentHash),
      )
    )
      throw new Error("The reconciliation heads changed before apply.");
    await transport.publishWorkstream({
      schemaVersion: 1,
      registrationId: registration.registrationId,
      projectId: registration.project.projectId,
      repositoryIdentityHash: registration.projectIdentityHash,
      ...plan.revision,
    });
    const applied = await readHubWorkstream(cycle);
    if (
      applied.status !== "current" ||
      applied.heads[0]?.snapshotContentHash !== plan.revision.snapshotContentHash
    )
      throw new Error("The Hub did not retain the exact reconciliation successor.");
    await local.importCurrent(plan.revision);
    output({
      schemaVersion: 1,
      status: "reconciled",
      planId: plan.planId,
      keep: plan.keep,
      workstreamId: plan.revision.snapshot.workstreamId,
      revision: 1,
      snapshotContentHash: plan.revision.snapshotContentHash,
      parents: plan.parents,
    });
    return 0;
  } finally {
    await storage.close();
  }
}
