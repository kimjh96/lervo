import { withPracticeAssignment } from "./practice-assignment.js";
import { callPracticeProvider } from "./practice-provider.js";
import {
  preparePracticeProvider,
  type PracticeProviderRequest,
  type PreparedPracticeProvider,
} from "./practice-provider-preparation.js";
import type { ConvergenceWorkerRole } from "./delegation.js";
import type { ConvergenceAssignmentAuthority } from "./workforce.js";

/** Admission waits never create failed workforce assignments. */
export async function withPracticeProviderAssignment<T>(
  input: PracticeProviderRequest & {
    role: ConvergenceWorkerRole;
    assignmentKey: string;
    paths: string[];
    assertAuthority?(authority: ConvergenceAssignmentAuthority): void;
    resolve(value: unknown, authority: ConvergenceAssignmentAuthority): T | Promise<T>;
  },
): Promise<T> {
  let prepared: PreparedPracticeProvider;
  return withPracticeAssignment({
    context: input.context,
    role: input.role,
    key: input.assignmentKey,
    paths: input.paths,
    prepare: async () => {
      prepared = await preparePracticeProvider(input);
      return prepared;
    },
    run: async (authority) => {
      input.assertAuthority?.(authority);
      return input.resolve(
        await callPracticeProvider({ ...input, authority, prepared }),
        authority,
      );
    },
  });
}
