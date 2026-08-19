import { type RemoteCommandTarget } from "@lervo/schemas";

import { PolicyRuntimeError } from "./errors.js";
import { verifyPolicyBundle } from "./bundle-verifier.js";
import {
  type PolicyBundle,
  type PolicyStateStore,
  type PolicyTrustStore,
} from "./types.js";

export interface AuthenticatedPolicyHubTransport {
  pullPolicyBundle(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    currentSnapshotId: string | null;
    requestedAt: string;
  }): Promise<unknown>;
}

export interface PolicySyncOptions {
  destinationId: string;
  expectedPeerIdentityHash: string;
  target: RemoteCommandTarget;
  transport: AuthenticatedPolicyHubTransport;
  trustStore: PolicyTrustStore;
  store: PolicyStateStore;
  clock?: { now(): string };
}

function body(input: {
  response: unknown;
  destinationId: string;
  peerHash: string;
}): unknown {
  if (
    typeof input.response !== "object" || input.response === null ||
    !("authentication" in input.response) || !("body" in input.response) ||
    typeof input.response.authentication !== "object" || input.response.authentication === null
  ) throw new PolicyRuntimeError("transport_authentication_failed", "policy transport 인증 응답이 없습니다.");
  const auth = input.response.authentication as Record<string, unknown>;
  if (
    auth.status !== "verified" || auth.destinationId !== input.destinationId ||
    auth.peerIdentityHash !== input.peerHash
  ) throw new PolicyRuntimeError("transport_authentication_failed", "policy transport peer가 다릅니다.");
  return input.response.body;
}

export async function runPolicySyncCycle(options: PolicySyncOptions): Promise<
  | { status: "offline"; failureCode: "hub_unavailable" | "transport_authentication_failed" }
  | { status: "unchanged"; snapshotId: string | null }
  | { status: "applied" | "duplicate"; snapshotId: string; approvalCount: number; revocationCount: number }
> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(options.destinationId) ||
    !/^sha256:[a-f0-9]{64}$/.test(options.expectedPeerIdentityHash) ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(options.target.projectId) ||
    !/^sha256:[a-f0-9]{64}$/.test(options.target.projectIdentityHash)
  ) throw new PolicyRuntimeError("invalid_runtime_configuration", "policy sync 설정이 유효하지 않습니다.");
  const now = (options.clock ?? { now: () => new Date().toISOString() }).now();
  if (!Number.isFinite(Date.parse(now))) {
    throw new PolicyRuntimeError("invalid_runtime_configuration", "policy sync clock이 유효하지 않습니다.");
  }
  let current;
  try {
    current = await options.store.getCurrentSnapshot();
  } catch (error) {
    throw new PolicyRuntimeError("policy_store_failed", "현재 policy snapshot을 읽지 못했습니다.", { cause: error });
  }
  let response;
  try {
    response = await options.transport.pullPolicyBundle({
      destinationId: options.destinationId,
      target: structuredClone(options.target),
      currentSnapshotId: current?.snapshot.snapshotId ?? null,
      requestedAt: now,
    });
  } catch {
    return { status: "offline", failureCode: "hub_unavailable" };
  }
  let received;
  try {
    received = body({ response, destinationId: options.destinationId, peerHash: options.expectedPeerIdentityHash });
  } catch (error) {
    if (error instanceof PolicyRuntimeError && error.code === "transport_authentication_failed") {
      return { status: "offline", failureCode: error.code };
    }
    throw error;
  }
  if (received === null) {
    return { status: "unchanged", snapshotId: current?.snapshot.snapshotId ?? null };
  }
  const verified = await verifyPolicyBundle({
    bundle: received as PolicyBundle,
    target: options.target,
    trustStore: options.trustStore,
    store: options.store,
    verifiedAt: now,
  });
  try {
    return await options.store.applyVerifiedBundle(verified);
  } catch (error) {
    throw new PolicyRuntimeError("policy_store_failed", "검증된 policy bundle을 저장하지 못했습니다.", { cause: error });
  }
}
