import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EnvironmentAdapterRegistry,
  evaluateEnvironmentSourceCandidate,
  loadEnvironmentObservations,
  loadEnvironmentSource,
  queryEnvironmentSource,
  resolveEnvironmentTarget,
  storeEnvironmentObservation,
  type EnvironmentObservation,
  type EnvironmentSourceAdapter,
  type EnvironmentSourceManifest,
} from "../src/index.js";

const source: EnvironmentSourceManifest = {
  schemaVersion: 1,
  sourceId: "src_network_primary",
  adapterId: "fixture.network",
  scope: "project",
  capabilities: ["network.peer"],
  maximumValiditySeconds: 300,
  sharing: "local_only",
  configuration: {},
};

const subject = {
  subjectId: "sub_0123456789abcdef01234567",
  kind: "device" as const,
  labels: { "device.hostname": "worker" },
  capabilities: ["network.peer"],
  endpoints: [{ transport: "overlay", addressKind: "dns" as const, host: "worker.example" }],
};

describe("environment source admission and query", () => {
  it("applies the repository admission rule without adapter-specific core logic", () => {
    expect(evaluateEnvironmentSourceCandidate({
      manifest: source,
      discoveredBy: "agent.fixture",
      evidence: [{ kind: "source_session", observedAt: "2026-08-22T00:00:00.000Z" }],
    }, {
      schemaVersion: 1,
      defaultDecision: "review_required",
      rules: [{ ruleId: "allow_fixture", adapterId: "fixture.network", scopes: ["project"], decision: "auto_register" }],
    })).toEqual({ decision: "auto_register", ruleId: "allow_fixture", reason: "matching_rule" });
  });

  it("normalizes adapter output under the source validity bound", async () => {
    const adapter: EnvironmentSourceAdapter = {
      id: "fixture.network",
      async query() {
        return { status: "available", subjects: [subject], verification: [{ kind: "source_session", status: "verified" }] };
      },
    };
    const observation = await queryEnvironmentSource({
      source,
      registry: new EnvironmentAdapterRegistry([adapter]),
      observedAt: new Date("2026-08-22T00:00:00.000Z"),
    });
    expect(observation.validUntil).toBe("2026-08-22T00:05:00.000Z");
    expect(observation.subjects).toEqual([subject]);
  });

  it("rejects capabilities that the repository source did not authorize", async () => {
    const adapter: EnvironmentSourceAdapter = {
      id: "fixture.network",
      async query() {
        return { status: "available", subjects: [{ ...subject, capabilities: ["secret.admin"] }], verification: [] };
      },
    };
    await expect(queryEnvironmentSource({ source, registry: new EnvironmentAdapterRegistry([adapter]) }))
      .rejects.toMatchObject({ code: "invalid_environment_observation" });
  });
});

describe("environment repository state and resolution", () => {
  it("loads tracked source declarations and stores only normalized local state", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-environment-"));
    await mkdir(resolve(root, ".lervo/environment-sources"), { recursive: true });
    await writeFile(resolve(root, ".lervo/environment-sources/src_network_primary.source.yaml"), [
      "schemaVersion: 1",
      "sourceId: src_network_primary",
      "adapterId: fixture.network",
      "scope: project",
      "capabilities: [network.peer]",
      "maximumValiditySeconds: 300",
      "sharing: local_only",
      "configuration: {}",
      "",
    ].join("\n"));
    expect(await loadEnvironmentSource(root, source.sourceId)).toEqual(source);
    const observation: EnvironmentObservation = {
      schemaVersion: 1,
      sourceId: source.sourceId,
      adapterId: source.adapterId,
      scope: "project",
      status: "available",
      observedAt: "2026-08-22T00:00:00.000Z",
      validUntil: "2026-08-22T00:05:00.000Z",
      subjects: [subject],
      verification: [{ kind: "source_session", status: "verified", checkedAt: "2026-08-22T00:00:00.000Z" }],
    };
    const path = await storeEnvironmentObservation(root, observation);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(observation);
    expect(await loadEnvironmentObservations(root)).toEqual([observation]);
  });

  it("fails closed on equal candidates and uses an explicit source preference", () => {
    const observation = (sourceId: string): EnvironmentObservation => ({
      schemaVersion: 1,
      sourceId,
      adapterId: "fixture.network",
      scope: "project",
      status: "available",
      observedAt: "2026-08-22T00:00:00.000Z",
      validUntil: "2026-08-22T00:05:00.000Z",
      subjects: [{ ...subject, subjectId: sourceId === "src_network_primary" ? subject.subjectId : "sub_abcdef0123456789abcdef01" }],
      verification: [{ kind: "source_session", status: "verified", checkedAt: "2026-08-22T00:00:00.000Z" }],
    });
    const target = {
      schemaVersion: 1 as const,
      targetId: "tgt_always_on_host",
      requiredCapabilities: ["network.peer"],
      selectors: [{ label: "device.hostname", equals: "worker" }],
      preferredSourceIds: [] as string[],
    };
    const observations = [observation("src_network_primary"), observation("src_network_backup")];
    expect(resolveEnvironmentTarget({ target, observations, at: new Date("2026-08-22T00:01:00.000Z") }).status).toBe("ambiguous");
    expect(resolveEnvironmentTarget({
      target: { ...target, preferredSourceIds: ["src_network_backup"] },
      observations,
      at: new Date("2026-08-22T00:01:00.000Z"),
    })).toMatchObject({ status: "resolved", candidate: { sourceId: "src_network_backup" } });
  });

  it("does not resolve expired observations", () => {
    const result = resolveEnvironmentTarget({
      target: { schemaVersion: 1, targetId: "tgt_always_on_host", requiredCapabilities: ["network.peer"], selectors: [], preferredSourceIds: [] },
      observations: [{
        schemaVersion: 1, sourceId: source.sourceId, adapterId: source.adapterId, scope: "project", status: "available",
        observedAt: "2026-08-22T00:00:00.000Z", validUntil: "2026-08-22T00:05:00.000Z", subjects: [subject], verification: [{ kind: "source_session", status: "verified", checkedAt: "2026-08-22T00:00:00.000Z" }],
      }],
      at: new Date("2026-08-22T00:05:01.000Z"),
    });
    expect(result).toEqual({ status: "unresolved", targetId: "tgt_always_on_host", reason: "no_fresh_verified_match" });
  });
});
