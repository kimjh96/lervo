/**
 * AGENTS.md invariant 5: Lervo applies freshness changes only to Lervo-managed bytes. Tests that
 * exercise the apply path name the documents they treat as Lervo-managed, and tests of the
 * suggestion path the documents they treat as user-owned; every other document keeps its real
 * ownership. Used from a `vi.mock("@lervo/repository-knowledge")` factory.
 */
export function lervoManagedDocuments<
  T extends {
    documentFreshnessOwnershipResolver: (
      repositoryRoot: string,
    ) => Promise<(path: string) => "lervo_managed" | "user_owned">;
  },
>(actual: T, managed: ReadonlySet<string>, userOwned: ReadonlySet<string> = new Set()): T {
  return {
    ...actual,
    documentFreshnessOwnershipResolver: async (repositoryRoot: string) => {
      const resolve = await actual.documentFreshnessOwnershipResolver(repositoryRoot);
      return (path: string) =>
        managed.has(path) ? "lervo_managed" : userOwned.has(path) ? "user_owned" : resolve(path);
    },
  };
}
