import { NodeSupervisionError } from "./supervision-authority.js";

/** Preserve the failing source boundary without exposing paths, prompts, or source contents. */
export function assertSupervisionSourceBinding(input: {
  binding: { authorityDigest: string; taskDigest: string; combined: string } | null;
  authorityDigest: string;
  taskDigest: string;
  planDigest: string;
}): NonNullable<typeof input.binding> {
  const { binding } = input;
  if (binding === null) throw new NodeSupervisionError("supervision_authority_unavailable");
  if (input.authorityDigest !== binding.authorityDigest)
    throw new NodeSupervisionError("supervision_mandate_source_changed");
  if (input.taskDigest !== binding.taskDigest)
    throw new NodeSupervisionError("supervision_task_source_changed");
  if (input.planDigest !== binding.combined)
    throw new NodeSupervisionError("supervision_plan_source_changed");
  return binding;
}
