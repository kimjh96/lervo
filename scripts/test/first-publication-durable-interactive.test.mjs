import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from
  "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { createFileFirstPublicationReservationStore } from
  "../lib/file-first-publication-reservation-store.mjs";
import { executeFirstPublicationBootstrap } from
  "../lib/first-publication-execution.mjs";
import { createFirstPublicationExecutionPlan } from
  "../lib/first-publication-execution-plan.mjs";
import { createFirstPublicationReservation } from
  "../lib/first-publication-reservation.mjs";
import { prepareNpmInteractiveFirstPublisher } from
  "../lib/npm-interactive-first-publisher.mjs";
import { npmPublicRegistry } from "../lib/release-publication-authorization.mjs";
import { createFirstPublicationFixture } from "./fixtures/first-publication.mjs";

function fixture() {
  const source = createFirstPublicationFixture({
    tarballContents: Buffer.from("durable-interactive-tarball"),
  });
  return {
    artifact: source.artifact,
    bootstrap: source.bootstrap,
    publicationAuthorization: source.publicationAuthorization,
  };
}

function completion(reservation) {
  return {
    reservationId: reservation.reservationId,
    reservationDigest: reservation.reservationDigest,
    state: "published",
    executionReceiptDigest: `sha256:${"d".repeat(64)}`,
  };
}

describe("file first-publication reservation store", () => {
  it("recovers one reservation and terminal record from separate durable files", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-reservation-store-"));
    try {
      const stateRoot = resolve(root, "reservations");
      const reservation = createFirstPublicationReservation(
        fixture().bootstrap,
        "2026-08-21T03:01:00Z",
      );
      const store = createFileFirstPublicationReservationStore({ rootDirectory: stateRoot });
      await store.reserve(reservation);
      await store.complete(completion(reservation));
      const reopened = createFileFirstPublicationReservationStore({ rootDirectory: stateRoot });
      assert.deepEqual(await reopened.inspect(reservation.reservationId), {
        reservation,
        terminal: completion(reservation),
      });
      assert.deepEqual(await reopened.observe(reservation.reservationId), {
        schemaVersion: 1,
        source: "first_publication_reservation_store",
        state: "terminal",
        reservationId: reservation.reservationId,
        bootstrapDigest: reservation.bootstrapDigest,
        reservationDigest: reservation.reservationDigest,
        terminalState: "published",
      });
      assert.equal(
        (await stat(resolve(stateRoot, reservation.reservationId, "reservation.json"))).mode & 0o777,
        0o600,
      );
      assert.equal(
        (await stat(resolve(stateRoot, reservation.reservationId, "terminal.json"))).mode & 0o777,
        0o600,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses duplicate reservation and a second terminal transition", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-reservation-store-"));
    try {
      const reservation = createFirstPublicationReservation(
        fixture().bootstrap,
        "2026-08-21T03:01:00Z",
      );
      const store = createFileFirstPublicationReservationStore({ rootDirectory: root });
      await store.reserve(reservation);
      await assert.rejects(store.reserve(reservation), {
        code: "first_publication_already_reserved",
      });
      await store.abort({
        reservationId: reservation.reservationId,
        reservationDigest: reservation.reservationDigest,
        state: "aborted_before_publication",
        retry: "new_bootstrap_required",
      });
      await assert.rejects(store.complete(completion(reservation)), {
        code: "first_publication_already_terminal",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not replace a confirmed published terminal with unknown", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-reservation-store-"));
    try {
      const reservation = createFirstPublicationReservation(
        fixture().bootstrap,
        "2026-08-21T03:01:00Z",
      );
      const store = createFileFirstPublicationReservationStore({ rootDirectory: root });
      await store.reserve(reservation);
      await store.complete(completion(reservation));
      const result = await store.markUnknown({
        reservationId: reservation.reservationId,
        reservationDigest: reservation.reservationDigest,
        state: "publication_unknown",
        retry: "forbidden",
      });
      assert.deepEqual(result, completion(reservation));
      const stored = JSON.parse(await readFile(
        resolve(root, reservation.reservationId, "terminal.json"),
      ));
      assert.deepEqual(stored.record, completion(reservation));
      assert.match(stored.recordDigest, /^sha256:[a-f0-9]{64}$/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects terminal edits even when the edited state is structurally valid", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-reservation-store-"));
    try {
      const reservation = createFirstPublicationReservation(
        fixture().bootstrap,
        "2026-08-21T03:01:00Z",
      );
      const store = createFileFirstPublicationReservationStore({ rootDirectory: root });
      await store.reserve(reservation);
      await store.complete(completion(reservation));
      const terminalPath = resolve(root, reservation.reservationId, "terminal.json");
      const stored = JSON.parse(await readFile(terminalPath, "utf8"));
      stored.record = {
        reservationId: reservation.reservationId,
        reservationDigest: reservation.reservationDigest,
        state: "publication_unknown",
        retry: "forbidden",
      };
      await writeFile(terminalPath, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
      await assert.rejects(store.inspect(reservation.reservationId), {
        code: "first_publication_store_corrupt",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed on a poisoned partial reservation or symlink root", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-reservation-store-"));
    try {
      const reservation = createFirstPublicationReservation(
        fixture().bootstrap,
        "2026-08-21T03:01:00Z",
      );
      await mkdir(resolve(root, reservation.reservationId));
      const store = createFileFirstPublicationReservationStore({ rootDirectory: root });
      await assert.rejects(store.reserve(reservation), {
        code: "first_publication_already_reserved",
      });

      const target = resolve(root, "target");
      const linked = resolve(root, "linked");
      await mkdir(target);
      await symlink(target, linked);
      const unsafe = createFileFirstPublicationReservationStore({ rootDirectory: linked });
      await assert.rejects(unsafe.reserve(reservation), {
        code: "first_publication_store_unsafe",
      });

      const broad = resolve(root, "broad");
      await mkdir(broad, { mode: 0o700 });
      await chmod(broad, 0o755);
      const broadStore = createFileFirstPublicationReservationStore({ rootDirectory: broad });
      await assert.rejects(broadStore.reserve(reservation), {
        code: "first_publication_store_unsafe",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function successfulExecute(source, calls) {
  return async (_command, args) => {
    calls.push(args);
    if (args[0] === "--version") return { stdout: "11.17.0\n" };
    if (args[0] === "profile") {
      return { stdout: JSON.stringify({ tfa: { mode: "auth-and-writes", pending: false } }) };
    }
    if (args[0] === "view" && args[2] === "dist") {
      return { stdout: JSON.stringify({
        integrity: source.artifact.registryIntegrity,
        shasum: source.artifact.registryShasum,
      }) };
    }
    if (args[0] === "view" && args[2] === "dist-tags") {
      return { stdout: JSON.stringify({ latest: source.bootstrap.target.version }) };
    }
    assert.fail(`unexpected npm arguments: ${args.join(" ")}`);
  };
}

describe("npm interactive first publisher", () => {
  it("requires two explicit confirmations around an inherited-TTY direct publish", async () => {
    const source = fixture();
    const calls = [];
    const confirmations = [];
    let temporaryRoot;
    const session = await prepareNpmInteractiveFirstPublisher({
      bootstrap: source.bootstrap,
      userConfigPath: "/home/release/.npmrc",
    }, {
      execute: successfulExecute(source, calls),
      confirm: async (request) => {
        confirmations.push(request);
        return request.phrase;
      },
      runInteractive: async (_command, args, options) => {
        temporaryRoot = options.cwd;
        assert.equal(options.stdio, undefined);
        assert.equal(options.env.npm_config_provenance, undefined);
        assert.equal(options.env.NPM_CONFIG_USERCONFIG, "/home/release/.npmrc");
        assert.deepEqual(args, [
          "publish",
          "/release/lervo-cli-0.1.0.tgz",
          "--registry",
          npmPublicRegistry,
          "--tag",
          "latest",
          "--access",
          "public",
          "--ignore-scripts",
        ]);
        assert.equal(args.includes("--otp"), false);
      },
      environment: { npm_config_provenance: "false" },
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
    });
    const receipt = await session.publish({
      target: source.bootstrap.target,
      artifact: source.bootstrap.release.artifact,
      tarballPath: "/release/lervo-cli-0.1.0.tgz",
    });
    assert.equal(receipt.version, "0.1.0");
    assert.deepEqual(confirmations.map(({ phase }) => phase), [
      "before_publication",
      "second_factor_attestation",
    ]);
    assert.deepEqual(
      confirmations.map(({ phrase }) => phrase),
      createFirstPublicationExecutionPlan({
        bootstrap: source.bootstrap,
        publicationAuthorization: source.publicationAuthorization,
      }).confirmations.map(({ phrase }) => phrase),
    );
    await session.close();
    await assert.rejects(lstat(temporaryRoot), { code: "ENOENT" });
  });

  it("rejects non-TTY, injected OTP, and an account without write 2FA before publish", async () => {
    const source = fixture();
    const base = {
      execute: successfulExecute(source, []),
      confirm: async ({ phrase }) => phrase,
      runInteractive: async () => assert.fail("publish must not run"),
      stdinIsTTY: true,
      stdoutIsTTY: true,
      stderrIsTTY: true,
    };
    await assert.rejects(prepareNpmInteractiveFirstPublisher({
      bootstrap: source.bootstrap,
      userConfigPath: "/home/release/.npmrc",
    }, { ...base, stdinIsTTY: false, environment: {} }), {
      code: "npm_interactive_first_publication_preflight_failed",
    });
    await assert.rejects(prepareNpmInteractiveFirstPublisher({
      bootstrap: source.bootstrap,
      userConfigPath: "/home/release/.npmrc",
    }, { ...base, environment: { NPM_CONFIG_OTP: "secret" } }), {
      code: "npm_interactive_first_publication_preflight_failed",
    });
    await assert.rejects(prepareNpmInteractiveFirstPublisher({
      bootstrap: source.bootstrap,
      userConfigPath: "/home/release/.npmrc",
    }, {
      ...base,
      environment: {},
      execute: async (_command, args) => args[0] === "--version"
        ? { stdout: "11.17.0\n" }
        : { stdout: JSON.stringify({ tfa: { mode: "auth-only", pending: false } }) },
    }), { code: "npm_interactive_first_publication_2fa_not_ready" });
  });

  it("runs interactive preparation before observing or reserving", async () => {
    const source = fixture();
    let downstreamCalls = 0;
    await assert.rejects(executeFirstPublicationBootstrap({
      bootstrap: source.bootstrap,
      publicationAuthorization: source.publicationAuthorization,
      releaseDirectory: "/release",
    }, {
      preparePublish: async () => { throw new Error("operator declined"); },
      observePackage: async () => { downstreamCalls += 1; },
      reservationStore: {
        reserve: async () => { downstreamCalls += 1; },
        complete: async () => {},
        abort: async () => {},
        markUnknown: async () => {},
      },
      publish: async () => { downstreamCalls += 1; },
    }), { message: "operator declined" });
    assert.equal(downstreamCalls, 0);
  });
});
