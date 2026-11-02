/**
 * ADR-0561 removed every per-item owner approval from migration, normalization, document
 * structure, instruction bridge, canonicalization, and delegation scope commands. Each removed
 * option or command fails with one line naming what replaced it and how to undo.
 */
export const REMOVED_APPROVE_ITEM =
  "--approve-item was removed: Lervo cross-checks the plan independently and applies it with --apply <plan-id>; undo it with lervo knowledge revert <commit>.";

export const REMOVED_LAYOUT_DECISION =
  "--accept-layout and --decline-layout were removed: Lervo cross-checks the layout plan and applies it itself; undo it with lervo knowledge revert <commit>.";

export const REMOVED_CANONICALIZATION_REVIEW =
  "lervo knowledge canonicalization review and promote were removed: the background canonical reviewer promotes or rejects each candidate after its independent review; undo a decision with lervo knowledge canonicalization reopen <candidate-id>.";

export const REMOVED_SCOPE_RESPONSE =
  "lervo knowledge convergence delegation scope-response was removed: Lervo no longer proposes delegation scope changes, because a cross-checked layout plan carries its own exact paths; undo a layout move with lervo knowledge revert <commit>.";
