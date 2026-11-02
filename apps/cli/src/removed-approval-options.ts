/**
 * ADR-0561 removed every per-item owner approval from migration, normalization, document
 * structure, and instruction bridge commands. Each removed option fails with one line naming what
 * replaced it and how to undo.
 */
export const REMOVED_APPROVE_ITEM =
  "--approve-item was removed: Lervo cross-checks the plan independently and applies it with --apply <plan-id>; undo it with lervo knowledge revert <commit>.";

export const REMOVED_LAYOUT_DECISION =
  "--accept-layout and --decline-layout were removed: Lervo cross-checks the layout plan and applies it itself; undo it with lervo knowledge revert <commit>.";
