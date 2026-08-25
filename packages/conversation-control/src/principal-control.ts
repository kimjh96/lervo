import type { HubCommandControlReader, HubControlReviewGrants } from "@lervo/hub-control";

import type { ConversationHubControlPort } from "./types.js";
import { ConversationControlError } from "./types.js";

export interface ConversationPrincipalBinding {
  projectId: string;
  participantId: string;
  principalId: string;
  destinationId: string;
  permissions: readonly ("command.read" | "approval.review")[];
}

function bindingKey(projectId: string, participantId: string): string {
  return `${projectId}\0${participantId}`;
}

function reviewUrl(
  base: URL,
  input: {
    destinationId: string;
    projectId: string;
    deliveryId: string;
    reviewGrant: string;
  },
): string {
  const fragment = new URLSearchParams(input).toString();
  const value = new URL(base.href);
  value.hash = fragment;
  return value.href;
}

export class ConfiguredConversationHubControl implements ConversationHubControlPort {
  private readonly bindings = new Map<string, ConversationPrincipalBinding>();
  private readonly baseUrl: URL;

  constructor(
    private readonly options: {
      reader: HubCommandControlReader;
      reviewGrants: HubControlReviewGrants;
      reviewBaseUrl: string;
      bindings: readonly ConversationPrincipalBinding[];
    },
  ) {
    this.baseUrl = new URL(options.reviewBaseUrl);
    if (
      this.baseUrl.protocol !== "https:" ||
      this.baseUrl.username !== "" ||
      this.baseUrl.password !== "" ||
      this.baseUrl.search !== "" ||
      this.baseUrl.hash !== ""
    ) {
      throw new ConversationControlError(
        "control_command_invalid",
        "The Hub control URL must be an HTTPS URL without credentials, a query, or a fragment.",
      );
    }
    for (const binding of options.bindings) {
      this.validateBinding(binding);
      const key = bindingKey(binding.projectId, binding.participantId);
      if (this.bindings.has(key)) {
        throw new ConversationControlError(
          "control_command_invalid",
          "A conversation principal binding is duplicated.",
        );
      }
      this.bindings.set(key, { ...binding, permissions: [...binding.permissions] });
    }
  }

  async inspect(input: Parameters<ConversationHubControlPort["inspect"]>[0]) {
    if (input.event.actor.kind !== "human") {
      throw new ConversationControlError(
        "control_access_denied",
        "Only a human participant can inspect Hub control.",
      );
    }
    const binding = this.bindings.get(
      bindingKey(input.event.target.projectId, input.event.actor.participantId),
    );
    const required = input.operation === "command_status" ? "command.read" : "approval.review";
    if (binding === undefined || !binding.permissions.includes(required)) {
      throw new ConversationControlError(
        "control_access_denied",
        "The conversation participant does not have Hub control permission.",
      );
    }
    let review;
    try {
      review = await this.options.reader.inspect({
        destinationId: binding.destinationId,
        projectId: binding.projectId,
        deliveryId: input.deliveryId,
        inspectedAt: input.inspectedAt,
      });
    } catch (error) {
      throw new ConversationControlError(
        "control_source_failed",
        "Could not inspect Hub command status.",
        {
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
    return {
      review,
      reviewUrl:
        input.operation === "approval_review"
          ? reviewUrl(this.baseUrl, {
              destinationId: binding.destinationId,
              projectId: binding.projectId,
              deliveryId: input.deliveryId,
              reviewGrant: this.options.reviewGrants.issue({
                principalId: binding.principalId,
                destinationId: binding.destinationId,
                projectId: binding.projectId,
                deliveryId: input.deliveryId,
                issuedAt: input.inspectedAt,
              }),
            })
          : null,
    };
  }

  private validateBinding(binding: ConversationPrincipalBinding): void {
    if (
      !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(binding.projectId) ||
      !/^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(binding.participantId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(binding.principalId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(binding.destinationId) ||
      binding.permissions.length === 0 ||
      new Set(binding.permissions).size !== binding.permissions.length
    ) {
      throw new ConversationControlError(
        "control_command_invalid",
        "The conversation principal binding is invalid.",
      );
    }
  }
}
