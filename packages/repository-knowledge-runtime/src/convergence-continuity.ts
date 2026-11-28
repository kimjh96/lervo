import { homedir } from "node:os";
import { resolve } from "node:path";

import { readKnowledgeProviderPauseStates } from "./provider-admission-inspection.js";
import type { ProviderCliAdmissionProjection } from "@lervo/sync-contract";
import { readWorkerProviderSelection } from "./provider-cli-selection.js";
import { resolveAdmittedProviderCli } from "./provider-cli-admission.js";
import { readProviderCliProjection, providerCliFindings } from "./provider-cli-findings.js";
import type { ProjectStorage } from "@lervo/project-storage";
import { withRepositoryKnowledgeWorkerLock } from "@lervo/repository-knowledge-compiler";
import {
  calculateProjectIdentityHash,
  knowledgeConvergenceHostRecordFacts,
  knowledgeConvergenceOwnerFailureOf,
  type KnowledgeConvergenceHostListing,
  type KnowledgeConvergenceHostPublishStatus,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

import { continuityNextDeadline } from "./continuity-deadline.js";
import { continuityHostPort, listContinuityHosts, probeOwnerHub } from "./continuity-hub-port.js";
import {
  hostModelSelectionDirectory,
  publishedModelSelection,
  readHostModelSelection,
} from "./model-selection-host.js";
import { modelSelectionPath } from "@lervo/execution-contract";
import type { ContinuityTurnOutcome } from "./continuity-turn-outcome.js";
import { continuityInputFingerprint } from "./continuity-inputs.js";

import { continuityFindings } from "./continuity-findings.js";
import { ownerHostObservation } from "./continuity-owner-host-observation.js";
import { continuityHostRecord, continuityPeerSummary } from "./continuity-host-record.js";
import {
  nextContinuationFailure,
  readConvergenceContinuityState,
  writeConvergenceContinuityState,
  type ConvergenceContinuityState,
} from "./continuity-state.js";
import { readConvergenceOwnerFence } from "./convergence-owner-fence.js";
import {
  CONVERGENCE_OWNER_HOST_PATH,
  readConvergenceOwnerHost,
  type ConvergenceOwnerHubCoordinates,
} from "./convergence-owner-host.js";
import {
  deriveConvergenceOwnerHost,
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

export {
  CONTINUITY_RETRY_MILLISECONDS,
  type ContinuityTurnOutcome,
} from "./continuity-turn-outcome.js";

/** The Hub operations continuity needs; `@lervo/sync` provides the HTTP adapter. */
export interface ConvergenceHostRecordPort {
  publish(
    record: KnowledgeConvergenceHostRecord,
    signal?: AbortSignal,
  ): Promise<KnowledgeConvergenceHostPublishStatus>;
  /** ADR-0602: listings may carry each host's Hub presence. */
  list(signal?: AbortSignal): Promise<KnowledgeConvergenceHostListing[]>;
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

  /**
   * ADR-0602: the host-local files a reconciliation reads that no repository or event watch
   * covers: the host policy, the owner-host coordinates, the provider pause store, and the model
   * selection (ADR-0612 M3). Their change makes the next turn reconcile.
   */
  inputPaths(): string[] {
    const pauses = resolve(homedir(), ".lervo", "state", "knowledge-provider-admission");
    return [
      ...(this.input.policyPath === null ? [] : [this.input.policyPath]),
      resolve(this.root, CONVERGENCE_OWNER_HOST_PATH),
      resolve(pauses, "admission.sqlite"),
      resolve(pauses, "admission.sqlite-wal"),
      modelSelectionPath(hostModelSelectionDirectory()),
    ];
  }

  reconcile(
    options: { signal?: AbortSignal; force?: boolean } = {},
  ): Promise<ConvergenceContinuityState | null> {
    return this.turn(options).then((outcome) => outcome.state);
  }

  /**
   * ADR-0602: one reconciliation, telling a busy worker lock (another cycle holds it, so nothing
   * was reconciled) apart from a state that is current, so the caller never reads the last
   * state's passed deadline as a reason to look again at once.
   */
  turn(options: { signal?: AbortSignal; force?: boolean } = {}): Promise<ContinuityTurnOutcome> {
    const next = this.queue.then(() => this.reconcileNow(options));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private get root(): string {
    return this.input.storage.paths.repositoryRoot;
  }

  /**
   * ADR-0602: a reconciliation runs when forced (a Hub change), when its host-local inputs differ
   * from the ones the last one recorded, or once its own next deadline has passed; otherwise the
   * last state stands, however old it is.
   */
  private async reconcileNow(options: {
    signal?: AbortSignal;
    force?: boolean;
  }): Promise<ContinuityTurnOutcome> {
    const previous = await readConvergenceContinuityState(this.root);
    const candidates = await this.input.hubCandidates().catch(() => []);
    const inputs = await continuityInputFingerprint({
      root: this.root,
      policyPath: this.input.policyPath,
      hubCandidates: candidates,
      now: new Date(this.now()),
    });
    const recorded = previous?.nextReconcileAt ?? null;
    const dueAt = recorded === null ? null : Date.parse(recorded);
    if (
      options.force !== true &&
      previous !== null &&
      previous.inputFingerprint === inputs &&
      !(dueAt !== null && (!Number.isFinite(dueAt) || dueAt <= this.now()))
    )
      return { status: "current", state: previous };
    const locked = await withRepositoryKnowledgeWorkerLock(this.root, () =>
      this.reconcileLocked(previous, candidates, options.signal),
    );
    return locked.status === "busy"
      ? { status: "busy", state: previous }
      : { status: "reconciled", state: locked.result };
  }

  private async reconcileLocked(
    previous: ConvergenceContinuityState | null,
    candidates: ConvergenceOwnerHubCandidate[],
    signal: AbortSignal | undefined,
  ): Promise<ConvergenceContinuityState> {
    const startedAt = new Date(this.now());
    const identity = {
      projectId: this.input.storage.manifest.projectId,
      repositoryIdentityHash: calculateProjectIdentityHash(this.input.storage.manifest),
    };
    const ownerHost = await deriveConvergenceOwnerHost({
      root: this.root,
      candidates,
      probe: (hub) => probeOwnerHub(this.input.transport, hub, identity, signal),
      publication: this.input.publication,
      hostLabel: this.input.hostLabel,
      now: startedAt,
      hubSyncEnabled: this.input.storage.manifest.dataPolicy.hubSyncEnabled,
    }).catch(() => null);
    const host = await readConvergenceOwnerHost(this.root).catch(() => null);
    const { port, failureCode: portFailure } = await continuityHostPort(
      host,
      this.input.transport,
      this.input.storage,
    );
    const listing = await listContinuityHosts(port, host?.hostHash ?? null, signal);
    const { peers, ownListed, presenceHub } = listing;
    let hubFailure = portFailure ?? listing.failureCode;
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
    const record =
      host === null
        ? null
        : continuityHostRecord({
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
            // ADR-0612 M3: peers adopt a newer selection from this record.
            modelSelection: publishedModelSelection((await readHostModelSelection()).selection),
          });
    // ADR-0602: a record whose facts the Hub already holds is not published again, so two hosts
    // never wake each other with records that differ only in when they were observed. A Hub older
    // than ADR-0602 judges a peer by its record's age, so there it is published every time.
    const unchanged =
      presenceHub &&
      record !== null &&
      ownListed !== null &&
      knowledgeConvergenceHostRecordFacts(ownListed) ===
        knowledgeConvergenceHostRecordFacts(record);
    if (port !== null && record !== null && !unchanged)
      await port.publish(record, signal).catch((error: unknown) => {
        hubFailure ??= knowledgeConvergenceOwnerFailureOf(error).failureCode;
      });
    // ADR-0602: no cadence. A failure retries with exponential backoff; a due renewal this host
    // may not write (ADR-0478) waits for the ownership change that lets it, which the fence and
    // the Hub's change token both deliver; time-based decisions and findings set the deadline.
    const failed = continuity.failureCode !== null || hubFailure !== null;
    const failures = failed ? Math.min((previous?.failureStreak ?? 0) + 1, 64) : 0;
    const policy = continuity.policy;
    const nextReconcileAt = continuityNextDeadline({
      now: startedAt.getTime(),
      failures,
      renewAt: continuity.renewal?.kind === "current" ? continuity.renewal.renewAt : null,
      delegationExpiresAt: current?.expiresAt ?? null,
      policyHorizonAt: policy.status === "loaded" ? policy.policy.horizonAt : null,
      peers: peerSummaries,
      pauses,
    });
    // Recorded after the reconciliation's own writes, so they never read as a new input.
    const inputFingerprint = await continuityInputFingerprint({
      root: this.root,
      policyPath: this.input.policyPath,
      hubCandidates: candidates,
      now: startedAt,
    });
    const state: ConvergenceContinuityState = {
      ...(providerAdmission === null ? {} : { providerAdmission }),
      schemaVersion: 1,
      observedAt: startedAt.toISOString(),
      nextReconcileAt: nextReconcileAt === null ? null : new Date(nextReconcileAt).toISOString(),
      inputFingerprint,
      failureStreak: failures,
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
