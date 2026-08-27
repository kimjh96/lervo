export type OrganizationDeploymentSQLiteErrorCode =
  "capacity_exceeded" | "closed" | "integrity_failed" | "write_failed";

export class OrganizationDeploymentSQLiteError extends Error {
  constructor(
    readonly code: OrganizationDeploymentSQLiteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OrganizationDeploymentSQLiteError";
  }
}
