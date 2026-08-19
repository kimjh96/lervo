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
      "Platform instance identity 길이가 유효하지 않습니다.",
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
      "Platform adapter가 구현하지 않은 capability를 선언했습니다.",
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
