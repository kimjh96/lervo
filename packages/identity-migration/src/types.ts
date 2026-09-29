export type IdentityMigrationBlockerCode =
  | "repository_invalid"
  | "source_missing"
  | "source_unsafe"
  | "target_exists"
  | "source_changed"
  | "manifest_invalid"
  | "event_store_active"
  | "event_store_invalid"
  | "cas_invalid"
  | "scan_limit_exceeded";

export interface IdentityMigrationBlocker {
  readonly code: IdentityMigrationBlockerCode;
  readonly message: string;
}

export interface IdentityMigrationPlan {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly repositoryRoot: string;
  readonly sourceDirectory: ".roven";
  readonly targetDirectory: ".lervo";
  readonly status: "ready" | "blocked";
  readonly projectId: string | null;
  readonly sourceTreeHash: string | null;
  readonly sourceFileCount: number;
  readonly sourceByteCount: number;
  readonly preservedEventCount: number;
  readonly preservedEventHeadHash: string | null;
  readonly eventStoreSchemaVersion: number | null;
  readonly verifiedCasObjectCount: number;
  readonly documentDisposition: "create_empty" | "preserve_active" | "archive_previous_metadata";
  readonly documentArchivePath: string | null;
  readonly missingCurrentDirectories: readonly string[];
  readonly missingCurrentFiles: readonly {
    readonly path: ".lervo/.gitignore";
    readonly content: "data/\nstate/\nknowledge/convergence-delegation.json\n";
  }[];
  readonly blockers: readonly IdentityMigrationBlocker[];
}

export interface IdentityMigrationReceipt {
  readonly schemaVersion: 1;
  readonly planId: string;
  readonly projectId: string;
  readonly sourceTreeHash: string;
  readonly preservedEventCount: number;
  readonly preservedEventHeadHash: string | null;
  readonly verifiedCasObjectCount: number;
  readonly documentDisposition: IdentityMigrationPlan["documentDisposition"];
  readonly documentArchivePath: string | null;
  readonly completionEventId: string;
  readonly completionEventHash: string;
  readonly migratedAt: string;
}

export type IdentityMigrationErrorCode =
  "migration_blocked" | "plan_stale" | "apply_failed" | "finalization_failed";

export class IdentityMigrationError extends Error {
  constructor(
    readonly code: IdentityMigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "IdentityMigrationError";
  }
}
