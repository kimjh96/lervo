import { createHash } from "node:crypto";

import { assertConversationAdapterDescriptor } from "@lervo/conversation-contract";
import type {
  ConversationAdapterCapability,
  ConversationAdapterDescriptor,
} from "@lervo/schemas";

import {
  ConversationPlatformError,
  type ConversationPlatformKind,
} from "./types.js";

export function createPlatformConversationDescriptor(input: {
  integrationId: string;
  platform: ConversationPlatformKind;
  instanceIdentity: string;
  capabilities?: readonly ConversationAdapterCapability[];
  supportedCapabilities: readonly ConversationAdapterCapability[];
}): ConversationAdapterDescriptor {
  if (input.instanceIdentity.length < 1 || input.instanceIdentity.length > 512) {
    throw new ConversationPlatformError(
      "invalid_platform_configuration",
      "The platform instance identity length is invalid.",
    );
  }
  const capabilities = [...(input.capabilities ?? input.supportedCapabilities)].sort();
  const supported = new Set(input.supportedCapabilities);
  if (
    input.supportedCapabilities.length < 1 ||
    new Set(capabilities).size !== capabilities.length ||
    capabilities.some((capability) => !supported.has(capability))
  ) {
    throw new ConversationPlatformError(
      "invalid_platform_configuration",
      "The platform adapter declared a capability it does not implement.",
    );
  }
  const descriptor: ConversationAdapterDescriptor = {
    schemaVersion: 1,
    integrationId: input.integrationId,
    adapterKind: input.platform,
    instanceIdentityHash: `sha256:${createHash("sha256")
      .update(input.instanceIdentity, "utf8").digest("hex")}`,
    capabilities,
  };
  assertConversationAdapterDescriptor(descriptor);
  return descriptor;
}
