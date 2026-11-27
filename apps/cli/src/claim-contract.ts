// The claim contract between the pre-tool hook and the core's decision (Lervo ADE coordination,
// "The claim contract"): the request a write makes, and the decision with its holder.
import type { HostedClaimAnswering } from "@lervo/adapter-contract";

/** The conversation a session writes for, and the agent whose lease its claims widen. */
export interface WritingSession {
  readonly workspaceId: string;
  readonly agentId: string;
}

/** A write a conversation's session is about to make. */
export interface WriteClaimRequest<Session extends WritingSession = WritingSession> {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly providerSessionId: string;
  readonly toolUseId: string | null;
  readonly intent: NonNullable<ReturnType<HostedClaimAnswering["writeIntent"]>>;
  /** The conversation as finding the session's conversation returned it. */
  readonly session: Session;
  /** When the hook answers regardless, on the `performance.now()` clock. */
  readonly deadline: number;
  /**
   * Aborted when the hook answered without this decision, so the write went ahead: a claim that
   * has not taken the scheduler lock stops, and records no refusal.
   */
  readonly signal: AbortSignal;
  /** Called as the claim takes the scheduler lock; the hook then lets it finish before exiting. */
  readonly lockTaken: () => void;
}

/** One holder's refusal of some of a request's paths, as the claim log keeps it. */
export interface ClaimRefusalGroup {
  readonly code: string;
  readonly paths: readonly string[];
  /** The holder's paths that overlap `paths`, when they differ from them. */
  readonly heldPaths?: readonly string[];
  readonly holder: { readonly agentId: string; readonly workspaceId: string | null } | null;
}

/** Who holds a refused path: a live lease, another conversation's changed bytes, or a sealed change. */
export interface ClaimHolder {
  readonly agentId: string;
  readonly displayName: string;
  readonly roleName: string;
  /** `unknown` when the agent's record could not be read; a message then mentions nobody. */
  readonly origin: "team" | "lervo" | "unknown";
  readonly workspaceId: string | null;
  readonly conversationTitle: string | null;
  readonly kind: "lease" | "changed" | "sealed_change";
  /** The lease's expiry, or null when no timer frees the path. */
  readonly until: string | null;
}

/**
 * The core's answer to a claim (Lervo ADE coordination, "The claim contract"). A refusal names
 * its code, the repository-relative paths, the holder, and the message the agent receives.
 */
export type ClaimDecision =
  | { readonly decision: "allow" }
  | {
      readonly decision: "deny";
      readonly code: string;
      readonly paths: readonly string[];
      /** The holder's paths that overlap `paths`, when they differ from them. */
      readonly heldPaths?: readonly string[];
      readonly holder: ClaimHolder | null;
      readonly message: string;
      /** The other holders' refusals of the same request, which the message does not name. */
      readonly otherRefusals?: readonly ClaimRefusalGroup[];
    }
  | { readonly decision: "defer"; readonly code: string };

/** Claims a write for the session's conversation: the core's claim decision. */
export type WriteClaimer<Session extends WritingSession = WritingSession> = (
  request: WriteClaimRequest<Session>,
) => Promise<ClaimDecision>;

/** The code a deferral carries when Lervo could not decide in time, or failed without one. */
export const CLAIM_DEFERRED = "claim_deferred";
