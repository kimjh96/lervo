import {
  renewDuePolicySnapshots,
  type HubPolicyRenewalResult,
  type HubPolicyRenewalStore,
  type HubPolicySigner,
} from "@lervo/hub-policy";

import type { HubLifecycleServer } from "./artifact-cleanup-lifecycle.js";

/** A newly published policy is picked up within a day even when nothing else is due. */
export const POLICY_RENEWAL_MAXIMUM_WAIT_MS = 24 * 60 * 60_000;
/** A failed cycle retries well inside the renewal lead, so one failure never lets a policy lapse. */
export const POLICY_RENEWAL_RETRY_MS = 60 * 60_000;

export interface HubPolicyRenewalLifecycle {
  stop(): Promise<void>;
}

/**
 * ADR-0609: runs one renewal cycle when the server starts listening, then sleeps until the
 * earliest due head instead of polling. A failure is reported and retried; it never stops the
 * Hub, because remote commands only close when a policy actually expires.
 */
export function attachHubPolicyRenewalLifecycle(input: {
  server: HubLifecycleServer;
  store: HubPolicyRenewalStore;
  signer: HubPolicySigner;
  now?: () => string;
  onRenewed?: (result: HubPolicyRenewalResult) => void;
  onFailure?: (error: unknown) => void;
}): HubPolicyRenewalLifecycle {
  const now = input.now ?? (() => new Date().toISOString());
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;

  const schedule = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(run, Math.max(1_000, Math.min(POLICY_RENEWAL_MAXIMUM_WAIT_MS, delayMs)));
    timer.unref();
  };

  function run(): void {
    timer = null;
    if (stopped || running !== null) return;
    running = renewDuePolicySnapshots({ store: input.store, signer: input.signer, now })
      .then((result) => {
        if (result.renewed.length > 0) input.onRenewed?.(result);
        schedule(
          result.nextDueAt === null
            ? POLICY_RENEWAL_MAXIMUM_WAIT_MS
            : Date.parse(result.nextDueAt) - Date.parse(now()),
        );
      })
      .catch((error: unknown) => {
        input.onFailure?.(error);
        schedule(POLICY_RENEWAL_RETRY_MS);
      })
      .finally(() => {
        running = null;
      });
  }

  const requestStop = () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  input.server.once("listening", run);
  input.server.once("close", requestStop);
  if (input.server.listening) queueMicrotask(run);

  return {
    async stop() {
      requestStop();
      await running;
    },
  };
}
