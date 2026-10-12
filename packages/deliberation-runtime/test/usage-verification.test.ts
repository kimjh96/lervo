import type { DeliberationArtifact, EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  deliberationArtifactUsageVerification,
  deliberationProvesMultipleProviders,
  verifiedDeliberationParticipantCount,
} from "../src/index.js";

function usageEvent(input: {
  runId?: string;
  provider?: "codex" | "claude";
  scope?: string;
  status?: "observed" | "partial" | "unavailable";
}): EventEnvelope {
  const status = input.status ?? "observed";
  const provider = input.provider ?? "codex";
  return {
    type: "resource.usage.recorded",
    schemaVersion: 2,
    runId: input.runId ?? "run_proposer_0001",
    actor: { kind: "provider", provider },
    payload: {
      workId: "wrk_000000000000000000000001",
      resourceObservationId: "ruo_000000000000000000000001",
      sourceCoordinateDigest: `sha256:${"1".repeat(64)}`,
      scope: input.scope ?? "deliberation",
      source: "provider_reported",
      accountingMode: "turn_cumulative",
      accountingDescriptorHash: `sha256:${"2".repeat(64)}`,
      modelIdentity: {
        provider,
        requestedModel: null,
        answerModel: null,
        observedModelIds: [],
        answerModelEvidence: "unavailable",
        unavailableReason: "provider_model_unavailable",
      },
      status,
      usage:
        status === "unavailable"
          ? null
          : {
              inputTokens: 10,
              cachedInputTokens: 0,
              outputTokens: 5,
              reasoningOutputTokens: 0,
              totalTokens: 15,
              contextWindow: null,
            },
      reasonCode: status === "observed" ? null : "provider_usage_partial",
    },
  } as unknown as EventEnvelope;
}

function artifact(id: string, roleId: string): DeliberationArtifact {
  return { deliberationArtifactId: id, producer: { roleId } } as unknown as DeliberationArtifact;
}

describe("deliberation usage verification", () => {
  it("verifies only complete deliberation-scope usage of the producing run and provider", () => {
    const verify = (runEvents: EventEnvelope[]) =>
      deliberationArtifactUsageVerification({
        runId: "run_proposer_0001",
        provider: "codex",
        runEvents,
      });
    expect(verify([usageEvent({})])).toBe("verified");
    expect(verify([])).toBe("unverified");
    expect(verify([usageEvent({ scope: "primary_provider" })])).toBe("unverified");
    expect(verify([usageEvent({ status: "partial" })])).toBe("unverified");
    expect(verify([usageEvent({ status: "unavailable" })])).toBe("unverified");
    expect(verify([usageEvent({ provider: "claude" })])).toBe("unverified");
    expect(verify([usageEvent({ runId: "run_reviewer_0001" })])).toBe("unverified");
  });

  it("counts a participant only when every artifact it produced is verified", () => {
    const artifacts = [
      artifact("dla_proposal00001", "proposer"),
      artifact("dla_revision00001", "proposer"),
      artifact("dla_review0000001", "reviewer"),
    ];
    expect(
      verifiedDeliberationParticipantCount(
        artifacts,
        new Map([
          ["dla_proposal00001", "verified"],
          ["dla_revision00001", "unverified"],
          ["dla_review0000001", "verified"],
        ]),
      ),
    ).toBe(1);
  });

  it("proves several providers only from verified artifacts of two providers", () => {
    const recorded = (provider: "codex" | "claude", usageVerification?: string) =>
      ({
        seq: 0,
        type: "deliberation.artifact.recorded",
        actor: { kind: "agent", provider },
        payload: {
          deliberationId: "dlb_review000001",
          ...(usageVerification === undefined ? {} : { usageVerification }),
        },
      }) as unknown as EventEnvelope;
    const store = (events: EventEnvelope[]) => {
      const sequenced = events.map((event, index) => ({
        ...event,
        seq: index + 1,
        previousHash: index === 0 ? null : `hash_${index}`,
        eventHash: `hash_${index + 1}`,
      }));
      return {
        latest: () => sequenced.at(-1) ?? null,
        list: (options?: { afterSeq?: number; limit?: number }) =>
          sequenced
            .filter((event) => event.seq > (options?.afterSeq ?? 0))
            .slice(0, options?.limit ?? sequenced.length),
      };
    };
    const proves = (events: EventEnvelope[]) =>
      deliberationProvesMultipleProviders({
        events: store(events),
        deliberationId: "dlb_review000001",
      });
    expect(proves([recorded("codex", "verified"), recorded("claude", "verified")])).toBe(true);
    expect(proves([recorded("codex", "verified"), recorded("claude")])).toBe(false);
    expect(proves([recorded("codex", "verified"), recorded("codex", "verified")])).toBe(false);
    expect(proves([])).toBe(false);
  });
});
