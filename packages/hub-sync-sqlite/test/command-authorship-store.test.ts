import { generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { OwnerOnlyFileSystemCas } from "@lervo/cas";
import { authorHubCommand } from "@lervo/hub-command";
import { Ed25519RemoteCommandSigner } from "@lervo/remote-command";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import { databasePath, manifest, registerStore, removeTemporaryRoots } from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("Hub command authorship SQLite transaction", () => {
  it("shares one artifact across distinct commands and rolls queue back if authorship cannot commit", async () => {
    const path = await databasePath();
    const project = manifest("prj_command_author_01");
    const target = {
      projectId: project.projectId,
      projectIdentityHash: calculateProjectIdentityHash(project),
    };
    const store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    const artifacts = await OwnerOnlyFileSystemCas.open(`${path}.command-cas`);
    const signer = new Ed25519RemoteCommandSigner(
      "key_command_author_01",
      generateKeyPairSync("ed25519").privateKey,
    );
    let nonceByte = 9;
    const common = {
      store,
      artifacts,
      signer,
      destinationId: "hub:primary",
      target,
      principalId: "operator:command-author",
      authoredAt: "2026-08-22T01:00:00.000Z",
      nonce: () => Buffer.alloc(32, nonceByte++).toString("base64url"),
    };
    const request = {
      idempotencyKey: "idk_command_author_01",
      lifetimeMs: 120_000,
      roleId: "developer",
      provider: "codex",
      risk: "low" as const,
      verificationSuiteIds: ["repo.check"],
      request: "request referencing the same artifact",
    };

    await expect(authorHubCommand({ ...common, request })).resolves.toMatchObject({
      status: "created",
    });
    await expect(
      authorHubCommand({
        ...common,
        request: { ...request, idempotencyKey: "idk_command_author_02" },
      }),
    ).resolves.toMatchObject({ status: "created" });
    await expect(store.auditIntegrity()).resolves.toMatchObject({ valid: true });

    const fault = new DatabaseSync(path);
    fault.exec(`
      CREATE TRIGGER fixture_fail_command_authorship
      BEFORE INSERT ON hub_remote_command_authorships
      BEGIN SELECT RAISE(ABORT, 'fixture authorship failure'); END;
    `);
    fault.close();
    await expect(
      authorHubCommand({
        ...common,
        request: {
          ...request,
          idempotencyKey: "idk_command_author_03",
          request: "new orphan candidate",
        },
      }),
    ).rejects.toMatchObject({ code: "write_failed" });

    const inspection = new DatabaseSync(path, { readOnly: true });
    expect(inspection.prepare("SELECT COUNT(*) AS count FROM hub_remote_commands").get()).toEqual({
      count: 2,
    });
    expect(
      inspection.prepare("SELECT COUNT(*) AS count FROM hub_remote_command_authorships").get(),
    ).toEqual({ count: 2 });
    inspection.close();
    await store.close();
  });
});
