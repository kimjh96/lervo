export interface RepositoryRegistration {
  projectId: string;
  name: string;
  repositoryRoot: string;
  manifestSha256: string;
  registeredAt: string;
}

export interface RepositoryRegistry {
  schemaVersion: 1;
  kind: "lervo_repository_registry";
  repositories: RepositoryRegistration[];
}

export type RepositoryRegistrationChange = "registered" | "refreshed" | "unchanged";

export interface RegisterRepositoryResult {
  change: RepositoryRegistrationChange;
  registration: RepositoryRegistration;
}
