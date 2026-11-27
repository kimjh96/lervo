import { createHash } from "node:crypto";

import type { NoCapabilityJsonInvocationStrategy } from "@lervo/adapter-contract";

export class KnowledgeProviderAvailabilityError extends Error {
  readonly code = "knowledge_provider_paused";
  constructor(
    readonly reason: "quota" | "authentication",
    readonly observationHash: string,
    readonly resetAt: string | null,
  ) {
    super(`Knowledge provider admission is paused: ${reason}.`);
    this.name = "KnowledgeProviderAvailabilityError";
  }
}

/** Native failure envelopes are inspected here; model-authored text never controls admission. */
export function assertKnowledgeProviderAvailable(input: {
  strategy: Pick<NoCapabilityJsonInvocationStrategy, "isNativeFailureEvent">;
  status: string;
  stdout: string;
  stderr: string;
}): void {
  const failures: string[] = [];
  let resetAt: string | null = null;
  for (const line of input.stdout.split("\n")) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const event = value as Record<string, unknown>;
    if (!input.strategy.isNativeFailureEvent(event)) continue;
    failures.push(JSON.stringify(event));
    const error =
      event.error !== null && typeof event.error === "object"
        ? (event.error as Record<string, unknown>)
        : event;
    if (typeof error.reset_at === "string" && Number.isFinite(Date.parse(error.reset_at)))
      resetAt = new Date(error.reset_at).toISOString();
  }
  if (input.status !== "completed") failures.push(input.stderr);
  const native = failures.join("\n");
  const reason =
    /(?:rate[_ -]?limit|usage[_ -]?limit|weekly[_ -]?limit|quota[_ -]?(?:exceeded|exhausted)|hit your limit|too many requests)/iu.test(
      native,
    )
      ? "quota"
      : /(?:unauthenticated|authentication[_ -]?(?:required|failed)|not logged in|invalid[_ -]?(?:api[_ -]?key|auth[_ -]?token)|login required)/iu.test(
            native,
          )
        ? "authentication"
        : null;
  if (reason !== null)
    throw new KnowledgeProviderAvailabilityError(
      reason,
      `sha256:${createHash("sha256").update(native).digest("hex")}`,
      resetAt,
    );
}
