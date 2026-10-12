import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from "@lervo/sqlite-connection";

import type {
  ConversationPlatformDeliveryReplayPort,
  ConversationPlatformIdentityPort,
  ConversationPlatformIngressCursorPort,
  PlatformInboundIdentityRequest,
} from "@lervo/conversation-platform";

import { ConversationPlatformBindingRepository } from "./binding-repository.js";
import { ConversationPlatformCorrelationRepository } from "./correlation-repository.js";
import { ConversationPlatformIngressCursorRepository } from "./ingress-cursor-repository.js";
import {
  assertConversationPlatformDatabaseIntegrity,
  configureConversationPlatformDatabase,
  ensureConversationPlatformDatabasePath,
  migrateConversationPlatformDatabase,
  restrictConversationPlatformDatabase,
} from "./database.js";
import { ConversationPlatformSQLiteError } from "./errors.js";
import { ConversationPlatformReplayRepository } from "./replay-repository.js";
import type { SQLiteConversationPlatformStoreOptions } from "./types.js";

export class SQLiteConversationPlatformStore
  implements
    ConversationPlatformIdentityPort,
    ConversationPlatformDeliveryReplayPort,
    ConversationPlatformIngressCursorPort
{
  readonly path: string;
  private readonly bindings: ConversationPlatformBindingRepository;
  private readonly correlations: ConversationPlatformCorrelationRepository;
  private readonly replay: ConversationPlatformReplayRepository;
  private readonly ingressCursors: ConversationPlatformIngressCursorRepository;
  private closed = false;

  private constructor(
    path: string,
    private readonly database: DatabaseSync,
  ) {
    this.path = path;
    this.bindings = new ConversationPlatformBindingRepository(database);
    this.correlations = new ConversationPlatformCorrelationRepository(database);
    this.replay = new ConversationPlatformReplayRepository(database);
    this.ingressCursors = new ConversationPlatformIngressCursorRepository(database);
  }

  static async open(
    options: SQLiteConversationPlatformStoreOptions,
  ): Promise<SQLiteConversationPlatformStore> {
    const path = await ensureConversationPlatformDatabasePath(options.path);
    const database = openSqliteDatabase(path, {
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      await restrictConversationPlatformDatabase(path);
      configureConversationPlatformDatabase(database);
      migrateConversationPlatformDatabase(database);
      assertConversationPlatformDatabaseIntegrity(database);
      const store = new SQLiteConversationPlatformStore(path, database);
      store.bindings.install({
        conversations: options.conversations,
        participants: options.participants,
        threads: options.threads ?? [],
      });
      assertConversationPlatformDatabaseIntegrity(database);
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  static async openForDeliveryReconciliation(
    path: string,
  ): Promise<SQLiteConversationPlatformStore> {
    const absolute = resolve(path);
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new ConversationPlatformSQLiteError(
        "integrity_failed",
        "Delivery reconciliation requires an existing real platform store.",
      );
    }
    const database = openSqliteDatabase(absolute, {
      busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
      enableForeignKeyConstraints: true,
      allowExtension: false,
    });
    try {
      configureConversationPlatformDatabase(database);
      migrateConversationPlatformDatabase(database);
      assertConversationPlatformDatabaseIntegrity(database);
      return new SQLiteConversationPlatformStore(absolute, database);
    } catch (error) {
      database.close();
      throw error;
    }
  }

  async mapInbound(input: PlatformInboundIdentityRequest) {
    this.assertOpen();
    return this.bindings.mapInbound(input);
  }

  async mapOutbound(input: Parameters<ConversationPlatformIdentityPort["mapOutbound"]>[0]) {
    this.assertOpen();
    return this.bindings.mapOutbound(input);
  }

  async recordInbound(input: Parameters<ConversationPlatformIdentityPort["recordInbound"]>[0]) {
    this.assertOpen();
    this.correlations.recordInbound(input);
  }

  async recordOutbound(input: Parameters<ConversationPlatformIdentityPort["recordOutbound"]>[0]) {
    this.assertOpen();
    this.correlations.recordOutbound(input);
  }

  async readIngressCursor(
    input: Parameters<ConversationPlatformIngressCursorPort["readIngressCursor"]>[0],
  ) {
    this.assertOpen();
    return this.ingressCursors.read(input);
  }

  async advanceIngressCursor(
    input: Parameters<ConversationPlatformIngressCursorPort["advanceIngressCursor"]>[0],
  ) {
    this.assertOpen();
    this.ingressCursors.advance(input);
  }

  async begin(input: Parameters<ConversationPlatformDeliveryReplayPort["begin"]>[0]) {
    this.assertOpen();
    return this.replay.begin(input);
  }

  inspectDeliveryReplay(input: { platform: string; integrationId: string; outboundId: string }) {
    this.assertOpen();
    return this.replay.inspect(input);
  }

  async complete(input: Parameters<ConversationPlatformDeliveryReplayPort["complete"]>[0]) {
    this.assertOpen();
    this.replay.complete(input);
  }

  async reconcileDelivered(
    input: Parameters<ConversationPlatformDeliveryReplayPort["complete"]>[0],
  ) {
    this.assertOpen();
    this.replay.reconcileDelivered(input);
  }

  async markUnknown(input: Parameters<ConversationPlatformDeliveryReplayPort["markUnknown"]>[0]) {
    this.assertOpen();
    this.replay.markUnknown(input);
  }

  async markRejected(input: Parameters<ConversationPlatformDeliveryReplayPort["markRejected"]>[0]) {
    this.assertOpen();
    this.replay.markRejected(input);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new ConversationPlatformSQLiteError(
        "closed",
        "The conversation platform store is closed.",
      );
    }
  }
}
