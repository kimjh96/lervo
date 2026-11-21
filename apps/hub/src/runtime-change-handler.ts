import type { IncomingMessage, ServerResponse } from "node:http";
import { HubRuntimeChangeError, type HubRuntimeChangeSource } from "@lervo/hub-sync";
import type { HubRequestAuthenticator } from "./auth.js";
import {
  HUB_DESTINATION_ID_PATTERN,
  HUB_PROJECT_ID_PATTERN,
  HUB_PRINCIPAL_ID_PATTERN,
} from "./identifiers.js";
import {
  assertEmptyHubRequestBody,
  singleAuthorizationHeader,
  InvalidHubHttpRequestError,
} from "./request.js";
import { sendHubError, sendHubJson } from "./response.js";

interface RuntimeChangeChannel {
  authenticator: HubRequestAuthenticator;
  store: Partial<HubRuntimeChangeSource>;
  hubIdentityHash: string;
}

/** The permission a held wait needs: knowledge waits read like the knowledge coordination GETs. */
function topicPermitted(
  topic: "workstream" | "command" | "knowledge",
  permissions: readonly string[],
) {
  if (topic === "command") return permissions.includes("command.delivery");
  if (topic === "workstream") return permissions.includes("workstream.read");
  return permissions.includes("workspace.read") || permissions.includes("sync.write");
}

export function createHubRuntimeChangeHandler(channels: {
  workstream?: RuntimeChangeChannel;
  command?: RuntimeChangeChannel;
  /** ADR-0602 cross-host knowledge coordination changes. */
  knowledge?: RuntimeChangeChannel;
}) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    let headers: Record<string, string> = {};
    const maximum = 1_024;
    const controller = new AbortController();
    const disconnected = () => controller.abort();
    response.once("close", disconnected);
    try {
      if (request.method !== "GET") {
        sendHubError(response, 405, "method_not_allowed", maximum, headers);
        return;
      }
      assertEmptyHubRequestBody(request);
      const url = new URL(request.url ?? "", "http://lervo.invalid");
      const match = /^\/v1\/runtime-changes\/projects\/([^/]+)$/.exec(url.pathname);
      const projectId = match?.[1] ?? "";
      const parameters = url.searchParams;
      const allowed = [
        "destinationId",
        "repositoryIdentityHash",
        "topic",
        "nodeId",
        "cursor",
        "hold",
        "hostHash",
      ];
      if (
        [...parameters.keys()].some(
          (key) => !allowed.includes(key) || parameters.getAll(key).length !== 1,
        )
      )
        throw new InvalidHubHttpRequestError();
      const destinationId = parameters.get("destinationId") ?? "";
      const repositoryIdentityHash = parameters.get("repositoryIdentityHash") ?? "";
      const topic = parameters.get("topic");
      const nodeId = parameters.get("nodeId");
      const cursor = parameters.get("cursor");
      const hold = parameters.get("hold");
      const hostHash = parameters.get("hostHash");
      if (
        !HUB_PROJECT_ID_PATTERN.test(projectId) ||
        !HUB_DESTINATION_ID_PATTERN.test(destinationId) ||
        !/^sha256:[a-f0-9]{64}$/.test(repositoryIdentityHash) ||
        (topic !== "workstream" && topic !== "command" && topic !== "knowledge") ||
        (cursor !== null && !/^[a-f0-9-]{36}$/.test(cursor)) ||
        (hold !== null && hold !== "open") ||
        (hostHash !== null && (topic !== "knowledge" || !/^sha256:[a-f0-9]{64}$/.test(hostHash))) ||
        (topic === "command"
          ? nodeId === null || !HUB_PRINCIPAL_ID_PATTERN.test(nodeId)
          : nodeId !== null)
      )
        throw new InvalidHubHttpRequestError();
      const options = channels[topic];
      if (options === undefined) {
        sendHubError(response, 404, "not_found", maximum, headers);
        return;
      }
      headers = { "x-lervo-hub-identity": options.hubIdentityHash };
      const principal = await options.authenticator.authenticate(
        singleAuthorizationHeader(request),
      );
      if (principal === null) {
        sendHubError(response, 401, "unauthorized", maximum, headers);
        return;
      }
      const permitted = () =>
        principal.projects.some(
          (p) => p.projectId === projectId && p.destinationId === destinationId,
        ) &&
        topicPermitted(topic, principal.permissions) &&
        (topic !== "command" || principal.principalId === nodeId);
      if (!permitted()) {
        sendHubError(response, 403, "forbidden", maximum, headers);
        return;
      }
      if (options.store.waitForRuntimeChange === undefined) {
        sendHubError(response, 404, "not_found", maximum, headers);
        return;
      }
      const result = await options.store.waitForRuntimeChange({
        topic,
        projectId,
        repositoryIdentityHash,
        destinationId,
        cursor,
        signal: controller.signal,
        ...(hold === "open" ? { hold } : {}),
        ...(hostHash === null ? {} : { hostHash }),
      });
      if (controller.signal.aborted) return;
      // A held request must not disclose a hint after credential revocation.
      const refreshed = await options.authenticator.authenticate(
        singleAuthorizationHeader(request),
      );
      if (
        refreshed === null ||
        refreshed.principalId !== principal.principalId ||
        !refreshed.projects.some(
          (p) => p.projectId === projectId && p.destinationId === destinationId,
        ) ||
        !topicPermitted(topic, refreshed.permissions)
      ) {
        sendHubError(response, 403, "forbidden", maximum, headers);
        return;
      }
      sendHubJson(response, 200, { schemaVersion: 1, ...result }, maximum, headers);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof InvalidHubHttpRequestError)
          sendHubError(response, 400, "invalid_request", maximum, headers);
        else if (error instanceof HubRuntimeChangeError && error.code === "registration_required")
          sendHubError(response, 409, "conflict", maximum, headers);
        else if (error instanceof HubRuntimeChangeError && error.code === "capacity_exceeded")
          sendHubError(response, 429, "capacity_exceeded", maximum, headers);
        else sendHubError(response, 503, "internal_error", maximum, headers);
      }
    } finally {
      response.removeListener("close", disconnected);
    }
  };
}
