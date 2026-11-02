/**
 * ADR-0561 removed every per-item owner approval from migration, normalization, document
 * structure, instruction bridge, canonicalization, delegation scope, terminal integration,
 * upgrade, capability, and state commands. Each removed option or command fails with one line
 * naming what replaced it and how to undo.
 */
export const REMOVED_APPROVE_ITEM =
  "--approve-item was removed: Lervo cross-checks or backs up the plan and applies it with --apply <plan-id>; undo it with the command its notice prints (lervo knowledge revert <commit> or lervo state restore <backup-id>).";

export const REMOVED_LAYOUT_DECISION =
  "--accept-layout and --decline-layout were removed: Lervo cross-checks the layout plan and applies it itself; undo it with lervo knowledge revert <commit>.";

export const REMOVED_CANONICALIZATION_REVIEW =
  "lervo knowledge canonicalization review and promote were removed: the background canonical reviewer promotes or rejects each candidate after its independent review; undo a decision with lervo knowledge canonicalization reopen <candidate-id>.";

export const REMOVED_SCOPE_RESPONSE =
  "lervo knowledge convergence delegation scope-response was removed: Lervo no longer proposes delegation scope changes, because a cross-checked layout plan carries its own exact paths; undo a layout move with lervo knowledge revert <commit>.";

export const REMOVED_UPGRADE_APPROVAL =
  "--approval and --approve-role-binding were removed: lervo upgrade --apply plans, cross-checks, backs up, and applies every stage in one exclusive window; undo a stage with the command its receipt prints.";

export const REMOVED_APPLY_APPROVAL =
  "--approval was removed: --apply plans and applies in one run after taking a backup; undo it with lervo state restore <backup-id>.";

/** True when the arguments carry a removed option, in either `--name value` or `--name=value` form. */
export function hasRemovedOption(args: readonly string[], ...names: string[]): boolean {
  return args.some((arg) =>
    names.some((name) => arg === `--${name}` || arg.startsWith(`--${name}=`)),
  );
}
