import type { ConversationDeliberationPort, ConversationDeliberationSummary } from "./types.js";
import { ConversationControlError } from "./types.js";

export interface ConversationDeliberationPrincipalBinding {
  projectId: string;
  participantId: string;
  principalId: string;
  permissions: readonly ("deliberation.start" | "deliberation.read")[];
}

export interface ConversationDeliberationBackend {
  start(input: {
    projectId: string;
    principalId: string;
    sourceEventId: string;
    policyId: string;
    topic: string;
    requestedAt: string;
  }): Promise<ConversationDeliberationSummary>;
  inspect(input: {
    projectId: string;
    principalId: string;
    deliberationId: string;
    inspectedAt: string;
  }): Promise<ConversationDeliberationSummary>;
}

function key(projectId: string, participantId: string): string {
  return `${projectId}\0${participantId}`;
}

export class ConfiguredConversationDeliberationControl implements ConversationDeliberationPort {
  private readonly bindings = new Map<string, ConversationDeliberationPrincipalBinding>();

  constructor(private readonly options: {
    backend: ConversationDeliberationBackend;
    bindings: readonly ConversationDeliberationPrincipalBinding[];
  }) {
    for (const binding of options.bindings) {
      if (
        !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(binding.projectId) ||
        !/^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(binding.participantId) ||
        !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(binding.principalId) ||
        binding.permissions.length === 0 ||
        new Set(binding.permissions).size !== binding.permissions.length
      ) throw new ConversationControlError(
        "control_command_invalid",
        "Conversation 숙의 principal binding이 유효하지 않습니다.",
      );
      const bindingKey = key(binding.projectId, binding.participantId);
      if (this.bindings.has(bindingKey)) {
        throw new ConversationControlError(
          "control_command_invalid",
          "Conversation 숙의 principal binding이 중복되었습니다.",
        );
      }
      this.bindings.set(bindingKey, { ...binding, permissions: [...binding.permissions] });
    }
  }

  async start(input: Parameters<ConversationDeliberationPort["start"]>[0]) {
    const binding = this.authorize(input.event, "deliberation.start");
    return this.options.backend.start({
      projectId: binding.projectId,
      principalId: binding.principalId,
      sourceEventId: input.event.eventId,
      policyId: input.policyId,
      topic: input.topic,
      requestedAt: input.requestedAt,
    });
  }

  async inspect(input: Parameters<ConversationDeliberationPort["inspect"]>[0]) {
    const binding = this.authorize(input.event, "deliberation.read");
    return this.options.backend.inspect({
      projectId: binding.projectId,
      principalId: binding.principalId,
      deliberationId: input.deliberationId,
      inspectedAt: input.inspectedAt,
    });
  }

  private authorize(
    event: Parameters<ConversationDeliberationPort["start"]>[0]["event"],
    permission: "deliberation.start" | "deliberation.read",
  ): ConversationDeliberationPrincipalBinding {
    if (event.actor.kind !== "human") {
      throw new ConversationControlError(
        "control_access_denied",
        "사람 participant만 숙의를 시작하거나 조회할 수 있습니다.",
      );
    }
    const binding = this.bindings.get(key(event.target.projectId, event.actor.participantId));
    if (binding === undefined || !binding.permissions.includes(permission)) {
      throw new ConversationControlError(
        "control_access_denied",
        "대화 참여자에게 숙의 권한이 없습니다.",
      );
    }
    return binding;
  }
}
