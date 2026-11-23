import type { ProjectStorage } from "@lervo/project-storage";
import {
  calculateProjectIdentityHash,
  knowledgeConvergenceOwnerFailureOf,
  type KnowledgeConvergenceHostListing,
} from "@lervo/sync-contract";

import type {
  ConvergenceHostRecordPort,
  ConvergenceHostRecordTransport,
} from "./convergence-continuity.js";
import type { ConvergenceOwnerHost } from "./convergence-owner-host.js";
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
function withModelSelectionAdoption(
  port: ConvergenceHostRecordPort,
  hostHash: string,
): ConvergenceHostRecordPort {
  return {
    ...port,
    // A Hub older than ADR-0612 M3 rejects a record that carries the selection as invalid; the
    // record is published again without it, so continuity never waits on a Hub upgrade.
    publish: async (record, signal) => {
      try {
        return await port.publish(record, signal);
      } catch (error) {
        if (record.modelSelection === undefined || httpStatusOf(error) !== 400) throw error;
        const { modelSelection: _withheld, ...withoutSelection } = record;
        return port.publish(withoutSelection, signal);
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
    return { port: withModelSelectionAdoption(port, host.hostHash), failureCode: null };
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
