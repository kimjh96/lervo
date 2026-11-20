import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  scope: "delegation" as const,
};
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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

  it("corrects a derived base branch when the remote's default differs, and keeps it when the probe fails", async () => {
    const root = await checkout();
    await derive(root, { publication: async () => ({ ...publication, baseBranch: "fix/home" }) });
    expect((await readConvergenceOwnerHost(root))?.config.publication?.baseBranch).toBe("fix/home");
    // Within the interval the setting stays as derived.
    await derive(root, { now: new Date("2026-10-06T05:59:00.000Z") });
    expect((await readConvergenceOwnerHost(root))?.config.publication?.baseBranch).toBe("fix/home");
    const corrected = await derive(root, { now: new Date("2026-10-06T06:00:00.000Z") });
    expect(corrected.derivation.status).toBe("derived");
    expect((await readConvergenceOwnerHost(root))?.config.publication).toEqual(publication);
    await derive(root, {
      publication: async () => null,
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    expect((await readConvergenceOwnerHost(root))?.config.publication).toEqual(publication);
  });

  it("migrates the fixed roots a derived configuration holds to the delegation scope", async () => {
    const root = await checkout();
    const { scope: _scope, ...target } = publication;
    const legacy = { ...target, allowedRoots: ["docs/", ".lervo/knowledge/"] };
    await derive(root, { publication: async () => legacy });
    expect((await readConvergenceOwnerHost(root))?.config.publication).toEqual(legacy);
    let probes = 0;
    const result = await derive(root, {
      publication: async () => {
        probes++;
        return null;
      },
      now: new Date("2026-10-06T01:00:00.000Z"),
    });
    expect(probes).toBe(0);
    expect(result.derivation.status).toBe("derived");
    expect((await readConvergenceOwnerHost(root))?.config.publication).toEqual(publication);
  });

  it("keeps an ignore list the operator added to a derived configuration (ADR-0596)", async () => {
    const root = await checkout();
    await derive(root);
    const path = resolve(root, CONVERGENCE_OWNER_HOST_PATH);
    const written = JSON.parse(await readFile(path, "utf8")) as {
      publication: Record<string, unknown>;
    };
    const checks = { ignore: ["Vercel – web"] };
    written.publication.checks = checks;
    await writeFile(path, JSON.stringify(written));
    await chmod(path, 0o600);
    // The list does not turn the file into an operator configuration: derivation still follows
    // the remote and carries the list into what it writes.
    const corrected = await derive(root, {
      publication: async () => ({ ...publication, baseBranch: "trunk" }),
      now: new Date("2026-10-06T06:00:00.000Z"),
    });
    expect(corrected.derivation.status).toBe("derived");
    expect((await readConvergenceOwnerHost(root))?.config.publication).toEqual({
      ...publication,
      baseBranch: "trunk",
      checks,
    });
    const again = await derive(root, {
      publication: async () => ({ ...publication, baseBranch: "trunk" }),
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    expect(again.derivation.status).toBe("unchanged");
  });

  it("leaves an operator configuration's publication setting alone", async () => {
    const root = await checkout();
    await writeHostConfig(root, { hostId: `hst_${"4".repeat(32)}`, label: "mac", mode: "hub" });
    const before = await readFile(resolve(root, CONVERGENCE_OWNER_HOST_PATH), "utf8");
    await derive(root, {
      publication: async () => ({ ...publication, baseBranch: "trunk" }),
      now: new Date("2026-10-07T00:00:00.000Z"),
    });
    expect(await readFile(resolve(root, CONVERGENCE_OWNER_HOST_PATH), "utf8")).toBe(before);
  });
});
