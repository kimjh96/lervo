import { readKnowledgeProviderPauseStates } from "./provider-admission-inspection.js";
import type { ProviderCliAdmissionProjection } from "@lervo/sync-contract";
import { readWorkerProviderSelection } from "./provider-cli-selection.js";
import { resolveAdmittedProviderCli } from "./provider-cli-admission.js";
import { readProviderCliProjection, providerCliFindings } from "./provider-cli-findings.js";
import type { ProjectStorage } from "@lervo/project-storage";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import {
  calculateProjectIdentityHash,
  knowledgeConvergenceOwnerFailureOf,
  type KnowledgeConvergenceHostPublishStatus,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

import { continuityFindings, type ContinuityOwnerHostObservation } from "./continuity-findings.js";
import { continuityHostRecord, continuityPeerSummary } from "./continuity-host-record.js";
import {
  nextContinuationFailure,
  readConvergenceContinuityState,
  writeConvergenceContinuityState,
  type ConvergenceContinuityState,
} from "./continuity-state.js";
import { readConvergenceOwnerFence } from "./convergence-owner-fence.js";
import {
  readConvergenceOwnerHost,
  type ConvergenceOwnerHost,
  type ConvergenceOwnerHubCoordinates,
} from "./convergence-owner-host.js";
import {
  deriveConvergenceOwnerHost,
  type ConvergenceOwnerHostDerivationResult,
  type ConvergenceOwnerHubCandidate,
} from "./convergence-owner-host-derivation.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { continueConvergenceDelegation } from "./delegation-continuity.js";
import { observeDelegationWriter } from "./delegation-writer.js";
import {
  definitionExchangeFailureCode,
  hubDefinitionSource,
  publishBoundDefinitions,
  type ConvergenceDefinitionPort,
  type DefinitionExchangeObservation,
} from "./delegation-definition-exchange.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";
import { readKnowledgePublicationState } from "./knowledge-publication-state.js";
import { inspectKnowledgeResidentHealth } from "./resident-health.js";

/** Pure: the owner-host outcome the state records and findings read. */
function ownerHostObservation(
  derivation: ConvergenceOwnerHostDerivationResult | null,
  host: ConvergenceOwnerHost | null,
): ContinuityOwnerHostObservation {
  const state: ContinuityOwnerHostObservation["state"] =
    host === null || derivation === null || derivation.derivation.status === "invalid"
      ? "invalid"
      : derivation.derivation.status === "operator"
        ? "operator"
        : host.config.coordination.mode;
  return {
    state,
    hubFailureCode:
      state === "standalone" || state === "hub"
        ? (derivation?.hubFailure?.failureCode ?? null)
        : null,
    publication:
      host?.config.coordination.mode !== "hub"
        ? "not_applicable"
        : host.config.publication === undefined
          ? "unavailable"
          : "configured",
  };
}

/** Healthy hosts reconcile hourly; a failed step retries after a quarter hour. */
export const CONTINUITY_RECONCILE_MILLISECONDS = 60 * 60_000;
export const CONTINUITY_RETRY_MILLISECONDS = 15 * 60_000;

/** The Hub operations continuity needs; `@lervo/sync` provides the HTTP adapter. */
export interface ConvergenceHostRecordPort {
  publish(
    record: KnowledgeConvergenceHostRecord,
    signal?: AbortSignal,
  ): Promise<KnowledgeConvergenceHostPublishStatus>;
  list(signal?: AbortSignal): Promise<KnowledgeConvergenceHostRecord[]>;
  /** ADR-0477 delegation-bound definitions through the same Hub; absent in older adapters. */
  definitions?: ConvergenceDefinitionPort;
}

export type ConvergenceHostRecordTransport = (
  target: ConvergenceOwnerHubCoordinates & { projectId: string; repositoryIdentityHash: string },
) => Promise<ConvergenceHostRecordPort>;

export interface ConvergenceContinuityInput {
  storage: ProjectStorage;
  /** The host continuity policy file; null when this host has no user state directory. */
  policyPath: string | null;
  /** Hub coordinates this host already uses for sync, most specific first. */
  hubCandidates: () => Promise<ConvergenceOwnerHubCandidate[]>;
  transport?: ConvergenceHostRecordTransport;
  /** Publication settings the host's own `gh` session can serve, or null. */
  publication: () => Promise<KnowledgePublicationSettings | null>;
  hostLabel: string;
  now?: () => number;
  providerAdmission?: () => Promise<ProviderCliAdmissionProjection | null>;
}

/**
 * ADR-0469 continuity for one checkout: derive the owner-host configuration, keep the delegation
 * continuous under the host policy, exchange host records through the Hub, and persist the
 * findings attention and the doctor read. It runs before the ownership observation of a resident
 * cycle, off every developer path, and never throws into the resident.
 */
export class ConvergenceContinuity {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly input: ConvergenceContinuityInput) {
    this.now = input.now ?? Date.now;
  }

  reconcile(
    options: { signal?: AbortSignal; force?: boolean } = {},
  ): Promise<ConvergenceContinuityState | null> {
    const next = this.queue.then(() => this.reconcileNow(options));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private get root(): string {
    return this.input.storage.paths.repositoryRoot;
  }

  private async reconcileNow(options: {
    signal?: AbortSignal;
    force?: boolean;
  }): Promise<ConvergenceContinuityState | null> {
    const previous = await readConvergenceContinuityState(this.root);
    if (
      options.force !== true &&
      previous !== null &&
      Date.parse(previous.nextReconcileAt) > this.now() &&
      !(await this.delegationChangedSince(previous))
    )
      return previous;
    const locked = await withRepositoryKnowledgeWorkerLock(this.root, () =>
      this.reconcileLocked(previous, options.signal),
    );
    return locked.status === "busy" ? previous : locked.result;
  }

  /** A delegation replaced by the owner since the last reconciliation is observed at once. */
  private async delegationChangedSince(previous: ConvergenceContinuityState): Promise<boolean> {
    const loaded = await loadConvergenceDelegation(this.root).catch(() => undefined);
    const expiresAt = loaded === undefined ? undefined : (loaded?.delegation.expiresAt ?? null);
    return expiresAt !== previous.delegation.expiresAt;
  }

  private async hostPort(
    host: ConvergenceOwnerHost | null,
  ): Promise<{ port: ConvergenceHostRecordPort | null; failureCode: string | null }> {
    if (host?.config.coordination.mode !== "hub" || this.input.transport === undefined)
      return { port: null, failureCode: null };
    try {
      return {
        port: await this.input.transport({
          ...host.config.coordination.hub,
          projectId: this.input.storage.manifest.projectId,
          repositoryIdentityHash: calculateProjectIdentityHash(this.input.storage.manifest),
        }),
        failureCode: null,
      };
    } catch (error) {
      return { port: null, failureCode: knowledgeConvergenceOwnerFailureOf(error).failureCode };
    }
  }

  private async reconcileLocked(
    previous: ConvergenceContinuityState | null,
    signal: AbortSignal | undefined,
  ): Promise<ConvergenceContinuityState> {
    const startedAt = new Date(this.now());
    const identity = {
      projectId: this.input.storage.manifest.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(this.input.storage.manifest),
    };
    const candidates = await this.input.hubCandidates().catch(() => []);
    const ownerHost = await deriveConvergenceOwnerHost({
      root: this.root,
      candidates,
      probe: async (hub) => {
        try {
          const port = await this.input.transport?.({ ...hub, ...identity });
          if (port === undefined)
            return { failureCode: "hub_configuration_invalid", httpStatus: null };
          await port.list(signal);
          return null;
        } catch (error) {
          return knowledgeConvergenceOwnerFailureOf(error);
        }
      },
      publication: this.input.publication,
      hostLabel: this.input.hostLabel,
      now: startedAt,
    }).catch(() => null);
    const host = await readConvergenceOwnerHost(this.root).catch(() => null);
    const { port, failureCode: portFailure } = await this.hostPort(host);
    let hubFailure = portFailure;
    let peers: KnowledgeConvergenceHostRecord[] = [];
    if (port !== null)
      try {
        peers = (await port.list(signal)).filter((record) => record.hostHash !== host?.hostHash);
      } catch (error) {
        hubFailure = knowledgeConvergenceOwnerFailureOf(error).failureCode;
      }
    const exchange: DefinitionExchangeObservation = { failureCode: null };
    const definitionPort = hubFailure === null ? (port?.definitions ?? null) : null;
    const writer = await observeDelegationWriter(this.root, startedAt.getTime());
    const continuity = await continueConvergenceDelegation({
      storage: this.input.storage,
      policyPath: this.input.policyPath,
      peers,
      hostHash: host?.hostHash ?? null,
      writer,
      definitions:
        definitionPort === null ? null : hubDefinitionSource(definitionPort, exchange, signal),
      now: startedAt,
    });
    const [current, fence, publication, health] = await Promise.all([
      loadConvergenceDelegation(this.root).then(
        (loaded) => loaded?.delegation ?? null,
        () => null,
      ),
      readConvergenceOwnerFence(this.root),
      readKnowledgePublicationState(this.root).catch(() => null),
      inspectKnowledgeResidentHealth(this.root).catch(() => null),
    ]);
    if (definitionPort !== null && host !== null)
      await publishBoundDefinitions({
        storage: this.input.storage,
        delegation: current,
        port: definitionPort,
        hostHash: host.hostHash,
        now: startedAt,
        ...(signal === undefined ? {} : { signal }),
      }).catch((error: unknown) => {
        exchange.failureCode ??= definitionExchangeFailureCode(error);
      });
    const verdict =
      fence === null
        ? null
        : { role: fence.verdict.role, failureCode: fence.verdict.failureCode ?? null };
    const ownerHostState = ownerHostObservation(ownerHost, host);
    const peerSummaries = peers.map(continuityPeerSummary);
    const pauses = await readKnowledgeProviderPauseStates({ now: startedAt });
    const providerAdmission =
      this.input.providerAdmission !== undefined
        ? await this.input.providerAdmission()
        : current?.state === "active"
          ? (
              await resolveAdmittedProviderCli({
                storage: this.input.storage,
                preferred:
                  (await readWorkerProviderSelection(this.root))?.provider ?? current.providers[0]!,
                allowed: current.providers,
                hostLabel: host?.config.hostLabel ?? this.input.hostLabel,
                admissionMode: "cached",
                providerPaused: async (provider) =>
                  pauses.find((pause) => pause.provider === provider)?.paused ?? false,
                now: startedAt,
              })
            ).projection
          : await readProviderCliProjection(this.root);
    const findings = [
      ...providerCliFindings(providerAdmission, pauses, startedAt),
      ...continuityFindings({
        now: startedAt.getTime(),
        delegation: continuity.delegation,
        policy: continuity.policy,
        renewal: continuity.renewal,
        continuationFailure: continuity.failureCode,
        ownerHost: ownerHostState,
        verdict,
        publicationStatus: publication?.status ?? null,
        hubFailure,
        definitionExchangeFailure: exchange.failureCode,
        peers: peerSummaries,
      }),
    ].slice(0, 32);
    if (port !== null && host !== null)
      await port
        .publish(
          continuityHostRecord({
            ...identity,
            host,
            observedAt: startedAt.toISOString(),
            continuity,
            delegation: current,
            verdict: fence?.verdict ?? null,
            publicationConfigured: host.config.publication !== undefined,
            publicationStatus: publication?.status ?? null,
            health,
            findings,
            providerAdmission,
          }),
          signal,
        )
        .catch((error: unknown) => {
          hubFailure ??= knowledgeConvergenceOwnerFailureOf(error).failureCode;
        });
    // ADR-0478: a due renewal this host may not write is checked again at the retry interval,
    // so a host that just took over ownership renews without waiting a whole hour.
    const failed =
      continuity.failureCode !== null || hubFailure !== null || continuity.awaitingOwner;
    const renewAt =
      continuity.renewal?.kind === "current" ? Date.parse(continuity.renewal.renewAt) : Infinity;
    const nextReconcileAt = Math.min(
      startedAt.getTime() +
        (failed ? CONTINUITY_RETRY_MILLISECONDS : CONTINUITY_RECONCILE_MILLISECONDS),
      Math.max(renewAt, startedAt.getTime() + 60_000),
    );
    const policy = continuity.policy;
    const state: ConvergenceContinuityState = {
      ...(providerAdmission === null ? {} : { providerAdmission }),
      schemaVersion: 1,
      observedAt: startedAt.toISOString(),
      nextReconcileAt: new Date(nextReconcileAt).toISOString(),
      hostHash: host?.hostHash ?? null,
      hostLabel: host?.config.hostLabel ?? null,
      ownerHost: ownerHostState,
      delegation: {
        state: continuity.delegation.state,
        expiresAt: "expiresAt" in continuity.delegation ? continuity.delegation.expiresAt : null,
        scopeHash: continuity.scopeHash,
      },
      policy:
        policy.status === "loaded"
          ? {
              state: policy.policy.state,
              horizonAt: policy.policy.horizonAt,
              authority: policy.policy.authority.kind,
            }
          : { state: policy.status, horizonAt: null, authority: null },
      lastContinuation:
        continuity.continuation === null
          ? (previous?.lastContinuation ?? null)
          : { ...continuity.continuation, at: startedAt.toISOString() },
      continuationFailure: nextContinuationFailure(
        previous?.continuationFailure ?? null,
        continuity.failureCode,
        startedAt.toISOString(),
      ),
      hub: {
        status:
          port === null && portFailure === null
            ? "not_configured"
            : hubFailure === null
              ? "ok"
              : "unavailable",
        failureCode: hubFailure,
      },
      peers: peerSummaries,
      findings,
    };
    await writeConvergenceContinuityState(this.root, state);
    return state;
  }
}
