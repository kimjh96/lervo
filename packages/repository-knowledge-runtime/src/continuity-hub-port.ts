import type { ProjectStorage } from "@lervo/project-storage";
import {
  calculateProjectIdentityHash,
  knowledgeConvergenceOwnerFailureOf,
  type KnowledgeConvergenceHostListing,
  type KnowledgeConvergenceOwnerFailure,
} from "@lervo/sync-contract";

import type {
  ConvergenceHostRecordPort,
  ConvergenceHostRecordTransport,
} from "./convergence-continuity.js";
import type { ConvergenceOwnerHost } from "./convergence-owner-host.js";
import type { ConvergenceOwnerHubCandidate } from "./convergence-owner-host-derivation.js";
import { adoptPeerModelSelection } from "./model-selection-host.js";

function httpStatusOf(error: unknown): number | null {
  const status = (error as { httpStatus?: unknown } | null)?.httpStatus;
  return typeof status === "number" ? status : null;
}

/**
 * ADR-0612 M3: every listing of this repository's host records also adopts a newer model
 * selection another host published, so the hosts converge on one selection. Adoption never fails
 * the listing, and this host's own record is skipped.
 */
/** Hub and repository coordinates that rejected a record carrying the selection, per process. */
const withholding = new Set<string>();

function withModelSelectionExchange(
  port: ConvergenceHostRecordPort,
  hostHash: string,
  key: string,
): ConvergenceHostRecordPort {
  return {
    ...port,
    // A Hub older than ADR-0612 M3 rejects a record that carries the selection as invalid; the
    // record is published again without it, so continuity never waits on a Hub upgrade. This
    // process then withholds the selection from that Hub, so each later publish is one request.
    publish: async (record, signal) => {
      const { modelSelection: _withheld, ...withoutSelection } = record;
      if (record.modelSelection === undefined || withholding.has(key))
        return port.publish(withoutSelection, signal);
      try {
        return await port.publish(record, signal);
      } catch (error) {
        if (httpStatusOf(error) !== 400) throw error;
        const status = await port.publish(withoutSelection, signal);
        withholding.add(key);
        return status;
      }
    },
    list: async (signal) => {
      const listed = await port.list(signal);
      await adoptPeerModelSelection(listed, hostHash).catch(() => undefined);
      return listed;
    },
  };
}

/** The Hub port for this checkout's host records, or the failure that kept it from opening. */
export async function continuityHostPort(
  host: ConvergenceOwnerHost | null,
  transport: ConvergenceHostRecordTransport | undefined,
  storage: ProjectStorage,
): Promise<{ port: ConvergenceHostRecordPort | null; failureCode: string | null }> {
  if (host?.config.coordination.mode !== "hub" || transport === undefined)
    return { port: null, failureCode: null };
  try {
    const port = await transport({
      ...host.config.coordination.hub,
      projectId: storage.manifest.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(storage.manifest),
    });
    const key = JSON.stringify([
      host.config.coordination.hub.baseUrl,
      host.config.coordination.hub.destinationId,
      storage.manifest.projectId,
    ]);
    return { port: withModelSelectionExchange(port, host.hostHash, key), failureCode: null };
  } catch (error) {
    return { port: null, failureCode: knowledgeConvergenceOwnerFailureOf(error).failureCode };
  }
}

/**
 * This repository's host records split into peers and this host's own record as the Hub holds it,
 * so an identical record is never published again. A Hub that reports presence judges peers by
 * it; an earlier one judges them by record age.
 */
export async function listContinuityHosts(
  port: ConvergenceHostRecordPort | null,
  hostHash: string | null,
  signal?: AbortSignal,
): Promise<{
  peers: KnowledgeConvergenceHostListing[];
  ownListed: KnowledgeConvergenceHostListing | null;
  presenceHub: boolean;
  failureCode: string | null;
}> {
  if (port === null) return { peers: [], ownListed: null, presenceHub: false, failureCode: null };
  try {
    const listed = await port.list(signal);
    return {
      peers: listed.filter((record) => record.hostHash !== hostHash),
      ownListed: listed.find((record) => record.hostHash === hostHash) ?? null,
      presenceHub: listed.some((record) => record.presence !== undefined),
      failureCode: null,
    };
  } catch (error) {
    return {
      peers: [],
      ownListed: null,
      presenceHub: false,
      failureCode: knowledgeConvergenceOwnerFailureOf(error).failureCode,
    };
  }
}

/** One host-record read with candidate coordinates for owner-host derivation: null when accepted. */
export async function probeOwnerHub(
  transport: ConvergenceHostRecordTransport | undefined,
  hub: ConvergenceOwnerHubCandidate["hub"],
  identity: { projectId: string; repositoryIdentityHash: string },
  signal: AbortSignal | undefined,
): Promise<KnowledgeConvergenceOwnerFailure | null> {
  try {
    const port = await transport?.({ ...hub, ...identity });
    if (port === undefined) return { failureCode: "hub_configuration_invalid", httpStatus: null };
    await port.list(signal);
    return null;
  } catch (error) {
    return knowledgeConvergenceOwnerFailureOf(error);
  }
}
