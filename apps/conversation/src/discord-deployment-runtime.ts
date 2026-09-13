import type { DiscordConversationAdapter } from "@lervo/adapter-discord";
import type { SQLiteConversationPlatformStore } from "@lervo/conversation-platform-sqlite";

import {
  DiscordConversationIngressProcessor,
  reconcileDiscordConversationHistory,
} from "./discord-ingress.js";
import { ConversationDiscordGatewayRuntime } from "./discord-runtime.js";
import type { ConversationInteractionRuntime } from "./interaction-runtime.js";
import type { ConversationApplicationOptions } from "./types.js";

interface DiscordDeploymentContext {
  adapters: ReadonlyMap<string, DiscordConversationAdapter>;
  interactions: ConversationInteractionRuntime;
  store: SQLiteConversationPlatformStore;
  processors: ReadonlyMap<string, DiscordConversationIngressProcessor>;
}

export class ConversationDiscordDeploymentRuntime {
  private readonly gatewayRuntime: ConversationDiscordGatewayRuntime;
  private context: DiscordDeploymentContext | null = null;

  constructor(private readonly options: ConversationApplicationOptions) {
    this.gatewayRuntime = new ConversationDiscordGatewayRuntime(
      options.discord ?? [],
      (integrationId, dispatch) => this.handleDispatch(integrationId, dispatch),
      (integrationId) => this.reconcileHistory(integrationId),
      options.fetch,
    );
  }

  get authentications() {
    return this.gatewayRuntime.authentications;
  }

  get gateways() {
    return this.gatewayRuntime.gateways;
  }

  attach(input: {
    adapters: ReadonlyMap<string, DiscordConversationAdapter>;
    interactions: ConversationInteractionRuntime;
    store: SQLiteConversationPlatformStore;
  }): void {
    if (this.context !== null) throw new Error("The Discord deployment runtime is already ready.");
    const processors = new Map<string, DiscordConversationIngressProcessor>();
    for (const [integrationId, adapter] of input.adapters) {
      processors.set(
        integrationId,
        new DiscordConversationIngressProcessor({
          integrationId,
          adapter,
          cursors: input.store,
          handleAccepted: async (ingress) => {
            await input.interactions.handle(
              ingress.event,
              ingress.responseActivity === null ? undefined : ingress.responseActivity,
            );
            await input.interactions.runDeliveryCycle(adapter);
          },
        }),
      );
    }
    this.context = { ...input, processors };
  }

  start(): void {
    if (this.gateways.size > 0 && this.context === null) {
      throw new Error("The Discord deployment runtime is not ready.");
    }
    this.gatewayRuntime.start();
  }

  stop(): void {
    this.gatewayRuntime.stop();
  }

  private async handleDispatch(
    integrationId: string,
    dispatch: Parameters<DiscordConversationAdapter["receiveGatewayDispatch"]>[0],
  ): Promise<void> {
    const adapter = this.context?.adapters.get(integrationId);
    const processor = this.context?.processors.get(integrationId);
    if (adapter === undefined || processor === undefined) {
      throw new Error("The Discord ingress runtime is not ready.");
    }
    const ingress = await adapter.receiveGatewayDispatch(dispatch);
    if (ingress.status === "goal_command") {
      const deployment = this.options.discord?.find((item) => item.integrationId === integrationId);
      if (deployment?.onGoalCommand === undefined)
        throw new Error("The Discord /goal command is not enabled for this integration.");
      await deployment.onGoalCommand({
        command: ingress.command,
        adapter,
        process: (result) => processor.process(result),
      });
      return;
    }
    await processor.process(ingress);
  }

  private async reconcileHistory(integrationId: string): Promise<void> {
    const adapter = this.context?.adapters.get(integrationId);
    const processor = this.context?.processors.get(integrationId);
    const history = this.gatewayRuntime.histories.get(integrationId);
    if (adapter === undefined || processor === undefined || history === undefined) {
      throw new Error("The Discord history reconciliation runtime is not ready.");
    }
    await reconcileDiscordConversationHistory({
      integrationId,
      addresses: this.options.conversations
        .filter(
          (binding) => binding.platform === "discord" && binding.integrationId === integrationId,
        )
        .map((binding) => ({
          tenantKey: binding.tenantKey,
          conversationKey: binding.conversationKey,
        })),
      adapter,
      history,
      cursors: this.context!.store,
      processor,
    });
  }
}
