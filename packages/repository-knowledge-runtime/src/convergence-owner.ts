import type { ProjectStorage } from "@lervo/project-storage";
import {
  calculateProjectIdentityHash,
  knowledgeConvergenceOwnerFailureOf,
  type KnowledgeConvergenceOwnerDecision,
  type KnowledgeConvergenceOwnerFailure,
  type KnowledgeConvergenceOwnerMutation,
  type KnowledgeConvergenceOwnerReading,
} from "@lervo/sync-contract";

import { convergenceOwnerEligible } from "./convergence-owner-eligibility.js";
import {
  recordConvergenceOwnerChange,
  type ConvergenceOwnerChangeReason,
} from "./convergence-owner-event.js";
import {
  readConvergenceOwnerFence,
  writeConvergenceOwnerFence,
  type ConvergenceOwnerFence,
} from "./convergence-owner-fence.js";
import { foreignKnowledgeCommits } from "./convergence-owner-history.js";
import {
  loadOrCreateConvergenceOwnerHost,
  type ConvergenceOwnerHost,
  type ConvergenceOwnerHubCoordinates,
} from "./convergence-owner-host.js";
import {
  CONVERGENCE_OWNER_LEASE_TTL_MS,
  CONVERGENCE_OWNER_YIELD_MS,
  heldLeaseCurrent,
  ownerHolderKey,
  standaloneVerdict,
  verdictFromHubDecision,
  verdictWithoutHub,
  withoutHubFailure,
  type ConvergenceOwnerVerdict,
} from "./convergence-owner-verdict.js";

/** The Hub lease operations the owner needs; `@lervo/sync` provides the HTTP adapter. */
export interface ConvergenceOwnerLeasePort {
  mutate(
    mutation: KnowledgeConvergenceOwnerMutation,
    signal?: AbortSignal,
  ): Promise<KnowledgeConvergenceOwnerDecision>;
  read(signal?: AbortSignal): Promise<KnowledgeConvergenceOwnerReading>;
}

export type ConvergenceOwnerLeaseTransport = (
  target: ConvergenceOwnerHubCoordinates & { projectId: string; repositoryIdentityHash: string },
) => Promise<ConvergenceOwnerLeasePort>;

type OwnerStorage = Pick<
  ProjectStorage,
  "events" | "manifest" | "paths" | "writableEventSchemaVersion"
>;

const iso = (milliseconds: number) => new Date(milliseconds).toISOString();

/**
 * ADR-0466 cross-host convergence ownership for one checkout. Every observation persists the
 * verdict as the commit fence before returning, so a process that loses ownership stops
 * committing even while an earlier cycle is still running. Calls are serialized.
 */
export class ConvergenceOwnership {
  private queue: Promise<unknown> = Promise.resolve();
  private port: { key: string; port: ConvergenceOwnerLeasePort } | null = null;
  private readonly now: () => number;

  constructor(
    private readonly input: {
      storage: OwnerStorage;
      /** Absent only for release, which never contends for ownership. */
      provider?: "codex" | "claude";
      transport?: ConvergenceOwnerLeaseTransport;
      /** The host continuity policy; a lapsed delegation it would renew stays eligible. */
      continuityPolicyPath?: string | null;
      now?: () => number;
    },
  ) {
    this.now = input.now ?? Date.now;
  }

  observe(signal?: AbortSignal): Promise<ConvergenceOwnerVerdict> {
    return this.serialized(() => this.observeNow(signal));
  }

  /**
   * Yields for one lease lifetime so a peer can claim. `hubReleased` is false when a held Hub
   * lease could not be released; the peer then claims after it expires, because this host stops
   * renewing it either way.
   */
  release(
    signal?: AbortSignal,
  ): Promise<{ verdict: ConvergenceOwnerVerdict; hubReleased: boolean | null }> {
    return this.serialized(async () => {
      const host = await loadOrCreateConvergenceOwnerHost(this.root);
      const previous = (await readConvergenceOwnerFence(this.root))?.verdict ?? null;
      const now = this.now();
      const hubReleased =
        host.config.coordination.mode === "hub" && previous?.role === "owner"
          ? await this.releaseLease(host, previous, signal).then(
              (released) => released,
              () => false,
            )
          : null;
      const verdict = await this.settle(
        host,
        {
          role: "yielding",
          reason: "convergence_owner_released",
          mode: host.config.coordination.mode,
          hostHash: host.hostHash,
          hostLabel: host.config.hostLabel,
          holder: null,
          validUntil: null,
          wakeAt: iso(now + CONVERGENCE_OWNER_YIELD_MS),
          grantedAt: null,
          yieldUntil: iso(now + CONVERGENCE_OWNER_YIELD_MS),
          observedAt: iso(now),
        },
        "release",
      );
      return { verdict, hubReleased };
    });
  }

  private get root(): string {
    return this.input.storage.paths.repositoryRoot;
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async observeNow(signal: AbortSignal | undefined): Promise<ConvergenceOwnerVerdict> {
    const now = this.now();
    let host: ConvergenceOwnerHost;
    try {
      host = await loadOrCreateConvergenceOwnerHost(this.root);
    } catch {
      const verdict: ConvergenceOwnerVerdict = {
        role: "unverifiable",
        reason: "convergence_owner_host_invalid",
        mode: "hub",
        hostHash: null,
        hostLabel: null,
        holder: null,
        validUntil: null,
        wakeAt: null,
        grantedAt: null,
        yieldUntil: null,
        observedAt: iso(now),
      };
      const fence = await readConvergenceOwnerFence(this.root);
      await writeConvergenceOwnerFence(this.root, {
        schemaVersion: 1,
        verdict,
        recordedHolderKey: fence?.recordedHolderKey ?? null,
      });
      return verdict;
    }
    const previous = (await readConvergenceOwnerFence(this.root))?.verdict ?? null;
    const identity = { hostHash: host.hostHash, hostLabel: host.config.hostLabel };
    const mode = host.config.coordination.mode;
    if (
      previous?.role === "yielding" &&
      previous.hostHash === host.hostHash &&
      previous.yieldUntil !== null &&
      Date.parse(previous.yieldUntil) > now
    )
      return previous;
    if (host.config.coordination.mode === "standalone")
      return this.settle(
        host,
        standaloneVerdict({
          foreignCommits: await foreignKnowledgeCommits({
            repositoryRoot: this.root,
            hostHash: host.hostHash,
            since: now - CONVERGENCE_OWNER_LEASE_TTL_MS,
          }),
          now,
          host: identity,
        }),
        "standalone",
      );
    // A Hub lease is only worth holding with an active delegation; standalone hosts keep the
    // legacy single-host behavior and their own authority checks.
    if (!(await this.eligible(now))) {
      if (previous?.role === "owner" && previous.hostHash === host.hostHash)
        await this.releaseLease(host, previous, signal).catch(() => undefined);
      return this.settle(
        host,
        {
          role: "ineligible",
          reason: "knowledge_authority_unavailable",
          mode,
          ...identity,
          holder: null,
          validUntil: null,
          wakeAt: null,
          grantedAt: null,
          yieldUntil: null,
          observedAt: iso(now),
        },
        previous?.role === "owner" ? "delegation" : null,
      );
    }
    if (heldLeaseCurrent({ previous, now, hostHash: host.hostHash }))
      return this.settle(
        host,
        { ...withoutHubFailure(previous!), reason: "lease_held", observedAt: iso(now) },
        null,
      );
    const leasePort = await this.leasePort(host);
    if ("failure" in leasePort)
      return this.settle(
        host,
        {
          ...verdictWithoutHub({ previous: null, now, host: identity, failure: leasePort.failure }),
          reason: "convergence_owner_transport_missing",
        },
        null,
      );
    const { port } = leasePort;
    const requestStartedAt = this.now();
    let decision: KnowledgeConvergenceOwnerDecision;
    try {
      decision = await port.mutate(
        {
          operation: "claim",
          request: {
            schemaVersion: 1,
            projectId: this.input.storage.manifest.projectId,
            repositoryIdentityHash: this.repositoryIdentityHash,
            hostHash: host.hostHash,
            hostLabel: host.config.hostLabel,
            ttlMs: CONVERGENCE_OWNER_LEASE_TTL_MS,
          },
        },
        signal,
      );
    } catch (error) {
      return this.settle(
        host,
        verdictWithoutHub({
          previous,
          now: this.now(),
          host: identity,
          failure: knowledgeConvergenceOwnerFailureOf(error),
        }),
        null,
      );
    }
    const verdict = verdictFromHubDecision({
      decision,
      requestStartedAt,
      observedAt: this.now(),
      host: identity,
    });
    const reason: ConvergenceOwnerChangeReason =
      decision.status === "granted" && decision.predecessor?.ended === "expired"
        ? "expiry"
        : "lease";
    return this.settle(host, verdict, reason);
  }

  private get repositoryIdentityHash(): string {
    return calculateProjectIdentityHash(this.input.storage.manifest);
  }

  private eligible(now: number): Promise<boolean> {
    return convergenceOwnerEligible({
      root: this.root,
      provider: this.input.provider,
      policyPath: this.input.continuityPolicyPath ?? null,
      now,
    });
  }

  /** The cached lease port, or why none exists: no transport (null) or a failed construction. */
  private async leasePort(
    host: ConvergenceOwnerHost,
  ): Promise<
    { port: ConvergenceOwnerLeasePort } | { failure: KnowledgeConvergenceOwnerFailure | null }
  > {
    if (host.config.coordination.mode !== "hub" || this.input.transport === undefined)
      return { failure: null };
    const key = JSON.stringify(host.config.coordination.hub);
    if (this.port?.key === key) return { port: this.port.port };
    try {
      const port = await this.input.transport({
        ...host.config.coordination.hub,
        projectId: this.input.storage.manifest.projectId,
        repositoryIdentityHash: this.repositoryIdentityHash,
      });
      this.port = { key, port };
      return { port };
    } catch (error) {
      return { failure: knowledgeConvergenceOwnerFailureOf(error) };
    }
  }

  private async releaseLease(
    host: ConvergenceOwnerHost,
    previous: ConvergenceOwnerVerdict,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
    const generation = previous.holder?.generation ?? null;
    const leasePort = await this.leasePort(host);
    if ("failure" in leasePort || generation === null) return false;
    const decision = await leasePort.port.mutate(
      {
        operation: "release",
        request: {
          schemaVersion: 1,
          projectId: this.input.storage.manifest.projectId,
          repositoryIdentityHash: this.repositoryIdentityHash,
          hostHash: host.hostHash,
          generation,
        },
      },
      signal,
    );
    return decision.status === "released";
  }

  /**
   * Persists the verdict as the commit fence, then records a holder change once. A release or a
   * delegation loss records the end of this host's holding even though no new holder is known.
   */
  private async settle(
    host: ConvergenceOwnerHost,
    verdict: ConvergenceOwnerVerdict,
    reason: ConvergenceOwnerChangeReason | null,
  ): Promise<ConvergenceOwnerVerdict> {
    const fence = await readConvergenceOwnerFence(this.root);
    const recorded = fence?.recordedHolderKey ?? null;
    const key = ownerHolderKey(verdict);
    const ended =
      (reason === "release" || reason === "delegation") &&
      recorded !== null &&
      recorded.startsWith(`${host.hostHash}#`);
    const changed = (key !== null && key !== recorded) || ended;
    const next: ConvergenceOwnerFence = {
      schemaVersion: 1,
      verdict,
      recordedHolderKey: changed ? (ended ? null : key) : recorded,
    };
    await writeConvergenceOwnerFence(this.root, next);
    if (changed && reason !== null) {
      try {
        recordConvergenceOwnerChange(this.input.storage, {
          repositoryIdentityHash: this.repositoryIdentityHash,
          holderHostHash: ended ? null : (verdict.holder?.hostHash ?? null),
          previousHolderHostHash: recorded === null ? null : recorded.split("#")[0]!,
          observerHostHash: host.hostHash,
          generation: ended ? null : (verdict.holder?.generation ?? null),
          mode: verdict.mode,
          reason,
          occurredAt: verdict.observedAt,
        });
      } catch {
        // The fence already carries ownership; the canonical record is retried on the next change.
        await writeConvergenceOwnerFence(this.root, { ...next, recordedHolderKey: recorded });
      }
    }
    return verdict;
  }
}
