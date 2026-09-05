import {
  assignmentMessageTriggerDescriptorHash,
  type AssignmentMessageTriggerAdapterV1,
  type AssignmentMessageTriggerDescriptorV1,
} from "@lervo/agent-workforce";

const descriptorMaterial: Omit<AssignmentMessageTriggerDescriptorV1, "descriptorHash"> = {
  schemaVersion: 1,
  adapterId: "lervo/reviewed-message-file",
  adapterVersion: "1.0.0",
  availability: "available",
  sourceEvidence: "reviewed_input",
  reviewBoundary: "exact_plan_apply",
  replayProtection: "source_event_key",
  externalIdentifiers: "excluded",
  capabilities: ["direct_message.handoff"],
};

export const reviewedMessageFileTriggerDescriptor: AssignmentMessageTriggerDescriptorV1 = {
  ...descriptorMaterial,
  descriptorHash: assignmentMessageTriggerDescriptorHash(descriptorMaterial),
};

export const reviewedMessageFileTriggerAdapter: AssignmentMessageTriggerAdapterV1 = {
  async inspect(input) {
    if (input.adapterId !== reviewedMessageFileTriggerDescriptor.adapterId) {
      throw new Error("The installed reviewed-message trigger adapter ID does not match.");
    }
    return {
      descriptor: structuredClone(reviewedMessageFileTriggerDescriptor),
      observation: structuredClone(input.source),
    };
  },
};
