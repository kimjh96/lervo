import { readFile, rm } from "node:fs/promises";
import { expect, it } from "vitest";
import { fixture } from "./fixture.js";
import {
  knowledgeProviderAdmissionState,
  pauseKnowledgeProvider,
  settleKnowledgeProviderProbe,
} from "../src/provider-admission.js";
import { probeKnowledgeProviderAvailability } from "../src/provider-probe.js";

it("clears an unknown reset only after one native no-capability probe with observed usage", async () => {
  const f = await fixture(true);
  try {
    const authority = { provider: "claude" as const, directory: f.admissionDirectory };
    await pauseKnowledgeProvider({
      ...authority,
      reason: "authentication",
      observationHash: `sha256:${"e".repeat(64)}`,
      resetAt: null,
    });
    const result = await probeKnowledgeProviderAvailability({
      storage: f.storage,
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
    });
    expect(result).toMatchObject({ resumed: true });
    expect(await knowledgeProviderAdmissionState(authority)).toMatchObject({
      paused: false,
      activeCalls: 0,
    });
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(1);
  } finally {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("preserves a newer native pause when an older probe finishes", async () => {
  const f = await fixture(true);
  try {
    const authority = { provider: "claude" as const, directory: f.admissionDirectory };
    await pauseKnowledgeProvider({
      ...authority,
      reason: "quota",
      observationHash: `sha256:${"d".repeat(64)}`,
      resetAt: null,
      now: new Date("2030-01-01"),
    });
    const prior = await knowledgeProviderAdmissionState(authority);
    await pauseKnowledgeProvider({
      ...authority,
      reason: "authentication",
      observationHash: `sha256:${"f".repeat(64)}`,
      resetAt: null,
      now: new Date("2030-01-02"),
    });
    expect(
      await settleKnowledgeProviderProbe({
        ...authority,
        priorObservationHash: prior.observationHash,
        priorObservedAt: prior.observedAt,
        observationHash: `sha256:${"a".repeat(64)}`,
      }),
    ).toBe(false);
    expect(await knowledgeProviderAdmissionState(authority)).toMatchObject({
      paused: true,
      observationHash: `sha256:${"f".repeat(64)}`,
    });
  } finally {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
