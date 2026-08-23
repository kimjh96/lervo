import { constants } from "node:fs";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  createFirstPublicationTerminalEnvelope,
  validateFirstPublicationTerminalEnvelope,
  validateStoredFirstPublicationReservation,
  validateStoredFirstPublicationTerminal,
} from "./first-publication-store-records.mjs";

const reservationIdPattern = /^fpr_[a-f0-9]{24}$/u;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const maximumRecordBytes = 64 * 1024;

function fail(code, message = "The CLI first-publication reservation store is invalid.") {
  throw new FirstPublicationBootstrapError(code, message);
}

async function ensureDirectory(path, create = false) {
  if (create) {
    let created = false;
    try {
      await mkdir(path, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    if (created) await syncDirectory(dirname(path));
  }
  const stats = await lstat(path);
  if (
    !stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0
  ) fail("first_publication_store_unsafe");
}

async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeDurable(path, value) {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(dirname(path));
}

async function readRecord(path) {
  const stats = await lstat(path);
  if (
    !stats.isFile() || stats.isSymbolicLink() || stats.size > maximumRecordBytes ||
    (stats.mode & 0o077) !== 0
  ) {
    fail("first_publication_store_unsafe");
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    fail("first_publication_store_corrupt");
  }
}

function boundTerminal(record, reservation) {
  const terminal = validateStoredFirstPublicationTerminal(record);
  if (
    terminal.reservationId !== reservation.reservationId ||
    terminal.reservationDigest !== reservation.reservationDigest
  ) fail("first_publication_terminal_conflict");
  return terminal;
}

async function readTerminal(path, reservation) {
  return boundTerminal(
    validateFirstPublicationTerminalEnvelope(await readRecord(path)),
    reservation,
  );
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function createFileFirstPublicationReservationStore({ rootDirectory }) {
  if (typeof rootDirectory !== "string" || !isAbsolute(rootDirectory)) {
    fail("first_publication_store_input_invalid");
  }

  async function existingReservation(input) {
    if (!reservationIdPattern.test(input?.reservationId ?? "") ||
        !digestPattern.test(input?.reservationDigest ?? "")) {
      fail("first_publication_store_input_invalid");
    }
    await ensureDirectory(rootDirectory, true);
    const directory = resolve(rootDirectory, input.reservationId);
    await ensureDirectory(directory);
    const reservation = validateStoredFirstPublicationReservation(
      await readRecord(resolve(directory, "reservation.json")),
    );
    if (
      reservation.reservationId !== input.reservationId ||
      reservation.reservationDigest !== input.reservationDigest
    ) fail("first_publication_reservation_conflict");
    return { directory, reservation };
  }

  async function writeTerminal(input) {
    validateStoredFirstPublicationTerminal(input);
    const { directory } = await existingReservation(input);
    try {
      await writeDurable(
        resolve(directory, "terminal.json"),
        createFirstPublicationTerminalEnvelope(input),
      );
    } catch (error) {
      if (error?.code === "EEXIST") fail("first_publication_already_terminal");
      throw error;
    }
    return structuredClone(input);
  }

  return {
    async observe(reservationId) {
      if (!reservationIdPattern.test(reservationId ?? "")) {
        fail("first_publication_store_input_invalid");
      }
      if (!await pathExists(rootDirectory)) {
        return {
          schemaVersion: 1,
          source: "first_publication_reservation_store",
          state: "missing",
          reservationId,
        };
      }
      await ensureDirectory(rootDirectory);
      const directory = resolve(rootDirectory, reservationId);
      if (!await pathExists(directory)) {
        return {
          schemaVersion: 1,
          source: "first_publication_reservation_store",
          state: "missing",
          reservationId,
        };
      }
      await ensureDirectory(directory);
      const reservation = validateStoredFirstPublicationReservation(
        await readRecord(resolve(directory, "reservation.json")),
      );
      if (reservation.reservationId !== reservationId) {
        fail("first_publication_reservation_conflict");
      }
      const terminalPath = resolve(directory, "terminal.json");
      if (!await pathExists(terminalPath)) {
        return {
          schemaVersion: 1,
          source: "first_publication_reservation_store",
          state: "reserved",
          reservationId,
          bootstrapDigest: reservation.bootstrapDigest,
          reservationDigest: reservation.reservationDigest,
        };
      }
      const terminal = await readTerminal(terminalPath, reservation);
      return {
        schemaVersion: 1,
        source: "first_publication_reservation_store",
        state: "terminal",
        reservationId,
        bootstrapDigest: reservation.bootstrapDigest,
        reservationDigest: reservation.reservationDigest,
        terminalState: terminal.state,
      };
    },
    async reserve(reservation) {
      validateStoredFirstPublicationReservation(reservation);
      await ensureDirectory(rootDirectory, true);
      const directory = resolve(rootDirectory, reservation.reservationId);
      try {
        await mkdir(directory, { mode: 0o700 });
        await syncDirectory(rootDirectory);
        await writeDurable(resolve(directory, "reservation.json"), reservation);
      } catch (error) {
        if (error?.code === "EEXIST") fail("first_publication_already_reserved");
        throw error;
      }
      return structuredClone(reservation);
    },
    complete: writeTerminal,
    abort: writeTerminal,
    async markUnknown(input) {
      try {
        return await writeTerminal(input);
      } catch (error) {
        if (error?.code !== "first_publication_already_terminal") throw error;
        const reservation = validateStoredFirstPublicationReservation(await readRecord(resolve(
          rootDirectory,
          input.reservationId,
          "reservation.json",
        )));
        return readTerminal(resolve(
          rootDirectory,
          input.reservationId,
          "terminal.json",
        ), reservation);
      }
    },
    async inspect(reservationId) {
      if (!reservationIdPattern.test(reservationId ?? "")) {
        fail("first_publication_store_input_invalid");
      }
      if (!await pathExists(rootDirectory)) fail("first_publication_store_missing");
      await ensureDirectory(rootDirectory);
      const directory = resolve(rootDirectory, reservationId);
      if (!await pathExists(directory)) fail("first_publication_store_missing");
      await ensureDirectory(directory);
      const reservation = validateStoredFirstPublicationReservation(
        await readRecord(resolve(directory, "reservation.json")),
      );
      let terminal = null;
      try {
        terminal = await readTerminal(
          resolve(directory, "terminal.json"),
          reservation,
        );
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return { reservation, terminal };
    },
  };
}
