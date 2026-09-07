import {
  LIVE_TRIGGER_HASH,
  LIVE_TRIGGER_ID,
  LIVE_TRIGGER_VERSION,
  liveTriggerHash,
} from "./integrity.js";
import { LiveTriggerContractError, type LiveTriggerAdapterDescriptorV1 } from "./types.js";

export function liveTriggerDescriptorHash(
  descriptor: Omit<LiveTriggerAdapterDescriptorV1, "descriptorHash">,
): string {
  return liveTriggerHash(descriptor);
}

export function assertLiveTriggerDescriptor(descriptor: LiveTriggerAdapterDescriptorV1): void {
  const { descriptorHash, ...material } = descriptor;
  if (
    descriptor.schemaVersion !== 1 ||
    !LIVE_TRIGGER_ID.test(descriptor.adapterId) ||
    descriptor.adapterId.length > 128 ||
    !LIVE_TRIGGER_VERSION.test(descriptor.adapterVersion) ||
    !LIVE_TRIGGER_HASH.test(descriptorHash) ||
    descriptorHash !== liveTriggerDescriptorHash(material) ||
    descriptor.authentication !== "hmac_sha256" ||
    descriptor.replayProtection !== "source_event_key" ||
    descriptor.externalIdentifiers !== "hashed_only" ||
    descriptor.capabilities.length !== 1 ||
    descriptor.capabilities[0] !== "assignment_routine.invoke"
  ) {
    throw new LiveTriggerContractError(
      "descriptor_invalid",
      "The live-trigger adapter descriptor is invalid or internally inconsistent.",
    );
  }
}
