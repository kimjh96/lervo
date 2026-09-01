export const foundationRehearsals = [
  {
    rehearsalId: "event_reader_upgrade",
    outcome: "exact_completion",
    evidencePath: "packages/project/test/event-writer-activation.test.ts",
  },
  {
    rehearsalId: "event_reader_failed_upgrade",
    outcome: "exact_rollback",
    evidencePath: "packages/project/test/event-writer-activation.test.ts",
  },
  {
    rehearsalId: "event_writer_rollback",
    outcome: "exact_completion",
    evidencePath: "packages/project/test/event-writer-activation.test.ts",
  },
  {
    rehearsalId: "repository_upgrade",
    outcome: "exact_completion",
    evidencePath: "apps/cli/test/upgrade-command.test.ts",
  },
  {
    rehearsalId: "repository_failed_upgrade",
    outcome: "exact_rollback",
    evidencePath: "apps/cli/test/upgrade-command.test.ts",
  },
  {
    rehearsalId: "knowledge_migration_idempotence",
    outcome: "exact_completion",
    evidencePath: "packages/repository-knowledge/test/repository-knowledge.test.ts",
  },
  {
    rehearsalId: "state_prune_recovery",
    outcome: "exact_completion",
    evidencePath: "packages/project/test/state-retention.test.ts",
  },
  {
    rehearsalId: "retrieval_drift_gate",
    outcome: "exact_completion",
    evidencePath: "packages/search/test/evaluation-bundle.test.ts",
  },
] as const;
