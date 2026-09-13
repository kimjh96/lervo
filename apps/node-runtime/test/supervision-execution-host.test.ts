import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { OperatingMandateV2 } from "@lervo/application-contract";
import { assertOperatingMandate, assertMandateExecutionSuccession } from "@lervo/work-controller";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRepositoryMandatePlan,
  installRepositoryMandate,
  inspectRepositoryMandate,
  revokeRepositoryMandate,
} from "../../cli/src/mandate-installation.js";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import {
  observeMandateExecutionAuthority,
  observeSupervisionHostIdentity,
} from "../src/supervision-execution-host.js";
import { supervisionFixture } from "./supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("reviewed designated execution host", () => {
  it("admits a version 2 mandate on its observed host with Hub enabled and preserves revocation", async () => {
    const f = await supervisionFixture(roots);
    await revokeRepositoryMandate({
      root: f.root,
      supervisionId: f.binding.supervisionId,
      workstreamId: f.binding.workstreamId,
      mandateHash: f.installed.mandateHash,
      installationEventId: f.installed.eventId,
      reviewerId: f.mandate.appointingAuthorityId,
    });
    const identity = await observeSupervisionHostIdentity();
    expect(Object.keys(identity).sort()).toEqual(["hostIdentityHash", "schemaVersion"]);
    const mandate: OperatingMandateV2 = {
      ...f.mandate,
      schemaVersion: 2,
      version: 2,
      executionAuthority: {
        schemaVersion: 1,
        mode: "designated_host",
        hostIdentityHash: identity.hostIdentityHash,
      },
    };
    const manifest = resolve(f.root, ".lervo/project.yaml");
    await writeFile(
      manifest,
      (await readFile(manifest, "utf8")).replace("hubSyncEnabled: false", "hubSyncEnabled: true"),
    );
    const plan = await createRepositoryMandatePlan({
      root: f.root,
      supervisionId: f.binding.supervisionId,
      mandate,
      reviewerId: mandate.appointingAuthorityId,
    });
    const installed = await installRepositoryMandate({
      root: f.root,
      plan,
      approval: plan.approvalHash,
      reviewerId: mandate.appointingAuthorityId,
    });
    f.binding.mandateHash = installed.mandateHash;
    f.observation.mandateHash = installed.mandateHash;
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
    });
    try {
      expect((await runtime.runCycle()).disposition).toBe("effect_confirmed");
      expect(f.counts().effects).toBe(1);
    } finally {
      await runtime.close();
    }
    await revokeRepositoryMandate({
      root: f.root,
      supervisionId: f.binding.supervisionId,
      workstreamId: f.binding.workstreamId,
      mandateHash: installed.mandateHash,
      installationEventId: installed.eventId,
      reviewerId: mandate.appointingAuthorityId,
    });
    expect(
      (await inspectRepositoryMandate({ root: f.root, supervisionId: f.binding.supervisionId }))
        ?.revoked,
    ).toBe(true);
  });

  it("rejects a different host before mandate installation or execution authority", async () => {
    const f = await supervisionFixture(roots);
    const mandate: OperatingMandateV2 = {
      ...f.mandate,
      schemaVersion: 2,
      version: 2,
      executionAuthority: {
        schemaVersion: 1,
        mode: "designated_host",
        hostIdentityHash: `sha256:${"0".repeat(64)}`,
      },
    };
    await expect(
      createRepositoryMandatePlan({
        root: f.root,
        supervisionId: f.binding.supervisionId,
        mandate,
        reviewerId: mandate.appointingAuthorityId,
      }),
    ).rejects.toThrow("not the mandate's designated execution authority");
    await expect(
      observeMandateExecutionAuthority({ mandate, hubSyncEnabled: true }),
    ).rejects.toThrow("designated execution authority");
  });

  it("keeps version 1 strict and rejects malformed host contracts", async () => {
    const f = await supervisionFixture(roots);
    const executionAuthority = {
      schemaVersion: 1 as const,
      mode: "designated_host" as const,
      hostIdentityHash: `sha256:${"a".repeat(64)}`,
    };
    expect(() =>
      assertOperatingMandate({ ...f.mandate, executionAuthority } as unknown as OperatingMandateV2),
    ).toThrow();
    expect(() =>
      assertOperatingMandate({ ...f.mandate, schemaVersion: 2 } as OperatingMandateV2),
    ).toThrow();
    expect(() =>
      assertOperatingMandate({
        ...f.mandate,
        schemaVersion: 2,
        executionAuthority: { ...executionAuthority, secret: "unexpected" },
      } as OperatingMandateV2),
    ).toThrow();
    expect(() =>
      assertOperatingMandate({ ...f.mandate, schemaVersion: 2, executionAuthority }),
    ).not.toThrow();
    const designated: OperatingMandateV2 = { ...f.mandate, schemaVersion: 2, executionAuthority };
    expect(() => assertMandateExecutionSuccession(f.installed, designated)).toThrow("Revoke");
    const previous = { ...f.installed, mandate: designated, revoked: true };
    expect(() => assertMandateExecutionSuccession(previous, f.mandate)).toThrow(
      "cannot be changed or removed",
    );
    expect(() =>
      assertMandateExecutionSuccession(previous, {
        ...designated,
        executionAuthority: { ...executionAuthority, hostIdentityHash: `sha256:${"b".repeat(64)}` },
      }),
    ).toThrow("cannot be changed or removed");
  });
});
