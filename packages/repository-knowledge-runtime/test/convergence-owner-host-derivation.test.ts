import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CONVERGENCE_OWNER_HOST_PATH,
  readConvergenceOwnerHost,
} from "../src/convergence-owner-host.js";
import {
  convergenceHostLabel,
  deriveConvergenceOwnerHost,
} from "../src/convergence-owner-host-derivation.js";
import { writeHostConfig } from "./convergence-owner-hosts.js";

const hub = {
  baseUrl: "https://hub.example/",
  bearerTokenFile: "/owner-only/hub-token",
  destinationId: "hub:primary",
  hubIdentityHash: `sha256:${"a".repeat(64)}`,
};
const publication = {
  remote: "origin",
  baseBranch: "main",
  branch: "lervo/knowledge-outputs",
  merge: "when_checks_pass" as const,
  allowedRoots: ["docs/", ".lervo/knowledge/"],
};
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function checkout(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-owner-host-derivation-"));
  directories.push(root);
  return root;
}

function derive(
  root: string,
  overrides: Partial<Parameters<typeof deriveConvergenceOwnerHost>[0]> = {},
) {
  return deriveConvergenceOwnerHost({
    root,
    candidates: [{ source: "node_runtime", hub }],
    probe: async () => null,
    publication: async () => publication,
    hostLabel: "wsl",
    now: new Date("2026-10-06T00:00:00.000Z"),
    random: () => "1".repeat(32),
    ...overrides,
  });
}

describe("owner-host derivation", () => {
  it("labels hosts by role, never by address", () => {
    expect(
      convergenceHostLabel({ platform: "darwin", release: "25.5.0", hostname: "m.local" }),
    ).toBe("mac");
    expect(
      convergenceHostLabel({
        platform: "linux",
        release: "5.15.153.1-microsoft-standard-WSL2",
        hostname: "box",
      }),
    ).toBe("wsl");
    expect(convergenceHostLabel({ platform: "linux", release: "6.1", hostname: "Build_01" })).toBe(
      "build-01",
    );
  });

  it("derives Hub mode with publication for an unconfigured checkout after a successful probe", async () => {
    const root = await checkout();
    const result = await derive(root);
    expect(result).toEqual({
      derivation: { status: "derived", mode: "hub", source: "node_runtime" },
      hubFailure: null,
      publication: "configured",
    });
    const host = await readConvergenceOwnerHost(root);
    expect(host?.config).toEqual({
      schemaVersion: 1,
      hostId: `hst_${"1".repeat(32)}`,
      hostLabel: "wsl",
      coordination: { mode: "hub", hub },
      publication,
    });
    expect((await stat(resolve(root, CONVERGENCE_OWNER_HOST_PATH))).mode & 0o777).toBe(0o600);
    expect((await derive(root)).derivation.status).toBe("unchanged");
  });

  it("migrates the legacy standalone default, keeping its host identity", async () => {
    const root = await checkout();
    await writeHostConfig(root, {
      hostId: `hst_${"2".repeat(32)}`,
      label: "local",
      mode: "standalone",
    });
    await derive(root);
    expect((await readConvergenceOwnerHost(root))?.config).toMatchObject({
      hostId: `hst_${"2".repeat(32)}`,
      hostLabel: "wsl",
      coordination: { mode: "hub" },
    });
  });

  it("never falls back to standalone ownership when the Hub refuses the project (ADR-0470)", async () => {
    const root = await checkout();
    const refused = await derive(root, {
      probe: async () => ({ failureCode: "hub_forbidden", httpStatus: 403 }),
    });
    expect(refused).toEqual({
      derivation: { status: "derived", mode: "hub", source: "node_runtime" },
      hubFailure: { failureCode: "hub_forbidden", httpStatus: 403 },
      publication: "unavailable",
    });
    // The unproven coordinates make the lease unverifiable, so this host stays read-only.
    expect((await readConvergenceOwnerHost(root))?.config.coordination).toEqual({
      mode: "hub",
      hub,
    });
    // Unproven coordinates are probed again; once the Hub accepts them they are proven.
    let probes = 0;
    const accepted = await derive(root, {
      probe: async () => {
        probes += 1;
        return null;
      },
    });
    expect(probes).toBe(1);
    expect(accepted.hubFailure).toBeNull();
    expect(accepted.derivation).toMatchObject({ mode: "hub" });
  });

  it("stays standalone only on a host without any Hub coordinates", async () => {
    const root = await checkout();
    expect((await derive(root, { candidates: [] })).derivation).toEqual({
      status: "derived",
      mode: "standalone",
      source: "none",
    });
  });

  it("never rewrites an operator-written configuration", async () => {
    const root = await checkout();
    await writeHostConfig(root, { hostId: `hst_${"3".repeat(32)}`, label: "mac", mode: "hub" });
    const before = await readFile(resolve(root, CONVERGENCE_OWNER_HOST_PATH), "utf8");
    expect((await derive(root)).derivation).toEqual({ status: "operator" });
    expect(await readFile(resolve(root, CONVERGENCE_OWNER_HOST_PATH), "utf8")).toBe(before);
  });

  it("follows changed coordinates of a configuration it wrote, and keeps Hub mode when sources vanish", async () => {
    const root = await checkout();
    await derive(root);
    const moved = { ...hub, baseUrl: "https://hub2.example/" };
    await derive(root, { candidates: [{ source: "node_runtime", hub: moved }] });
    expect((await readConvergenceOwnerHost(root))?.config.coordination).toEqual({
      mode: "hub",
      hub: moved,
    });
    expect((await derive(root, { candidates: [] })).derivation).toEqual({
      status: "unchanged",
      mode: "hub",
      source: "node_runtime",
    });
  });

  it("probes publication again only after six hours", async () => {
    const root = await checkout();
    let probes = 0;
    const unavailable = async () => {
      probes++;
      return null;
    };
    await derive(root, { publication: unavailable });
    await derive(root, { publication: unavailable, now: new Date("2026-10-06T05:00:00.000Z") });
    expect(probes).toBe(1);
    const result = await derive(root, { now: new Date("2026-10-06T06:00:00.000Z") });
    expect(result.publication).toBe("configured");
  });
});
