import { type RemoteCommandExecutionReceipt } from "@lervo/schemas";

import {
  type RemoteCommandReplayCoordinate,
  type RemoteCommandReplayDecision,
  type RemoteCommandReplayStore,
  type RemoteCommandReservationDecision,
} from "./types.js";

interface ReplayRecord extends RemoteCommandReplayCoordinate {
  reservationId: string;
  receipt: RemoteCommandExecutionReceipt | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryRemoteCommandReplayStore implements RemoteCommandReplayStore {
  private readonly byIdempotencyKey = new Map<string, ReplayRecord>();
  private readonly nonceOwners = new Map<string, string>();
  private readonly byReservationId = new Map<string, ReplayRecord>();
  private reservationSequence = 0;

  constructor(private readonly maxRecords = 1_024) {
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 100_000) {
      throw new Error("remote command replay store maxRecords가 유효하지 않습니다.");
    }
  }

  async inspect(coordinate: RemoteCommandReplayCoordinate): Promise<RemoteCommandReplayDecision> {
    return this.inspectCurrentState(coordinate);
  }

  private inspectCurrentState(
    coordinate: RemoteCommandReplayCoordinate,
  ): RemoteCommandReplayDecision {
    const existing = this.byIdempotencyKey.get(coordinate.idempotencyKey);
    if (existing !== undefined) {
      if (
        existing.commandHash !== coordinate.commandHash ||
        existing.nonce !== coordinate.nonce
      ) {
        return { status: "idempotency_conflict" };
      }
      return existing.receipt === null
        ? { status: "in_progress" }
        : { status: "duplicate", receipt: clone(existing.receipt) };
    }
    if (this.nonceOwners.has(coordinate.nonce)) return { status: "nonce_replay" };
    return { status: "available" };
  }

  async reserve(
    coordinate: RemoteCommandReplayCoordinate,
  ): Promise<RemoteCommandReservationDecision> {
    // This method intentionally has no await before insertion. In-memory inspection and
    // reservation must remain one synchronous critical section inside the JS event loop.
    const decision = this.inspectCurrentState(coordinate);
    if (decision.status !== "available") return decision;
    if (this.byIdempotencyKey.size >= this.maxRecords) {
      throw new Error("remote command replay store capacity를 초과했습니다.");
    }
    this.reservationSequence += 1;
    const reservationId = `remote-command-reservation-${this.reservationSequence}`;
    const record: ReplayRecord = {
      ...clone(coordinate),
      reservationId,
      receipt: null,
    };
    this.byIdempotencyKey.set(coordinate.idempotencyKey, record);
    this.nonceOwners.set(coordinate.nonce, coordinate.idempotencyKey);
    this.byReservationId.set(reservationId, record);
    return { status: "reserved", reservationId };
  }

  async complete(input: {
    reservationId: string;
    receipt: RemoteCommandExecutionReceipt;
  }): Promise<void> {
    const record = this.byReservationId.get(input.reservationId);
    if (
      record === undefined || record.receipt !== null ||
      record.commandHash !== input.receipt.commandHash ||
      record.idempotencyKey !== input.receipt.idempotencyKey
    ) {
      throw new Error("remote command replay reservation과 receipt가 일치하지 않습니다.");
    }
    record.receipt = clone(input.receipt);
  }
}
