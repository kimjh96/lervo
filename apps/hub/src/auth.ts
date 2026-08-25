import { createHash } from "node:crypto";

import { HUB_TRACE_MAX_PROJECT_SCOPE, type HubProjectTraceCursor } from "@lervo/hub-trace";

import {
  HUB_DESTINATION_ID_PATTERN,
  HUB_PRINCIPAL_ID_PATTERN,
  HUB_PROJECT_ID_PATTERN,
} from "./identifiers.js";

const MIN_BEARER_TOKEN_LENGTH = 32;
const MAX_BEARER_TOKEN_LENGTH = 4_096;

export interface HubAuthenticatedPrincipal {
  principalId: string;
  projects: HubProjectTraceCursor[];
  permissions: HubPermission[];
}

export type HubPermission =
  | "trace.read"
  | "sync.write"
  | "workstream.read"
  | "workstream.write"
  | "policy.read"
  | "policy.write"
  | "command.read"
  | "command.write"
  | "command.delivery"
  | "approval.write"
  | "capability.read"
  | "capability.publish";

export interface HubRequestAuthenticator {
  authenticate(authorization: string | undefined): Promise<HubAuthenticatedPrincipal | null>;
}

export interface HubBearerCredential extends HubAuthenticatedPrincipal {
  token: string;
}

function tokenDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function validateCredential(credential: HubBearerCredential): void {
  if (
    typeof credential.token !== "string" ||
    credential.token.length < MIN_BEARER_TOKEN_LENGTH ||
    credential.token.length > MAX_BEARER_TOKEN_LENGTH ||
    !/^[\x21-\x7e]+$/.test(credential.token)
  ) {
    throw new Error("The Hub bearer credential token format is invalid.");
  }
  if (!HUB_PRINCIPAL_ID_PATTERN.test(credential.principalId)) {
    throw new Error("The Hub bearer credential principalId format is invalid.");
  }
  if (
    !Array.isArray(credential.permissions) ||
    credential.permissions.length < 1 ||
    new Set(credential.permissions).size !== credential.permissions.length ||
    !credential.permissions.every((permission) =>
      (
        [
          "trace.read",
          "sync.write",
          "workstream.read",
          "workstream.write",
          "policy.read",
          "policy.write",
          "command.read",
          "command.write",
          "command.delivery",
          "approval.write",
          "capability.read",
          "capability.publish",
        ] as HubPermission[]
      ).includes(permission),
    )
  ) {
    throw new Error("A Hub bearer credential permission is invalid.");
  }
  if (
    !Array.isArray(credential.projects) ||
    credential.projects.length > HUB_TRACE_MAX_PROJECT_SCOPE
  ) {
    throw new Error(
      `A Hub bearer credential may scope at most ${HUB_TRACE_MAX_PROJECT_SCOPE} projects.`,
    );
  }
  for (const project of credential.projects) {
    if (
      typeof project !== "object" ||
      project === null ||
      !HUB_DESTINATION_ID_PATTERN.test(project.destinationId) ||
      !HUB_PROJECT_ID_PATTERN.test(project.projectId)
    ) {
      throw new Error("A Hub bearer credential project coordinate is invalid.");
    }
  }
}

function clonePrincipal(principal: HubAuthenticatedPrincipal): HubAuthenticatedPrincipal {
  return {
    principalId: principal.principalId,
    projects: principal.projects.map((project) => ({ ...project })),
    permissions: [...principal.permissions],
  };
}

export class ConfiguredBearerAuthenticator implements HubRequestAuthenticator {
  private readonly principals = new Map<string, HubAuthenticatedPrincipal>();

  constructor(credentials: readonly HubBearerCredential[]) {
    if (!Array.isArray(credentials) || credentials.length === 0) {
      throw new Error("At least one Hub bearer credential is required.");
    }
    for (const credential of credentials) {
      validateCredential(credential);
      const digest = tokenDigest(credential.token);
      if (this.principals.has(digest)) {
        throw new Error("Hub bearer credential tokens must be unique.");
      }
      this.principals.set(digest, clonePrincipal(credential));
    }
  }

  async authenticate(authorization: string | undefined): Promise<HubAuthenticatedPrincipal | null> {
    if (authorization === undefined || authorization.length > MAX_BEARER_TOKEN_LENGTH + 7) {
      return null;
    }
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    if (match === null) return null;
    const token = match[1]!;
    if (token.length < MIN_BEARER_TOKEN_LENGTH || token.length > MAX_BEARER_TOKEN_LENGTH) {
      return null;
    }
    const principal = this.principals.get(tokenDigest(token));
    return principal === undefined ? null : clonePrincipal(principal);
  }
}

export class ReloadableBearerAuthenticator implements HubRequestAuthenticator {
  private current: ConfiguredBearerAuthenticator;

  constructor(credentials: readonly HubBearerCredential[]) {
    this.current = new ConfiguredBearerAuthenticator(credentials);
  }

  replace(credentials: readonly HubBearerCredential[]): void {
    const candidate = new ConfiguredBearerAuthenticator(credentials);
    this.current = candidate;
  }

  authenticate(authorization: string | undefined): Promise<HubAuthenticatedPrincipal | null> {
    return this.current.authenticate(authorization);
  }
}
