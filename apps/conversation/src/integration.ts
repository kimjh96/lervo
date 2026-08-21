import type { ConversationAdapter } from "@lervo/conversation-contract";
import type {
  ConversationPlatformDeliveryReplayPort,
  ConversationPlatformIdentityPort,
  ConversationPlatformKind,
} from "@lervo/conversation-platform";
import type { ArtifactStore } from "@lervo/storage-contract";

export interface ConversationIntegrationContext {
  artifactStore: ArtifactStore;
  identity: ConversationPlatformIdentityPort;
  deliveryReplay: ConversationPlatformDeliveryReplayPort;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
}

/**
 * A null platform means that the adapter receives canonical Lervo coordinates
 * directly and therefore does not use external identifier bindings.
 */
export interface ConversationIntegrationDeployment {
  integrationId: string;
  platform: ConversationPlatformKind | null;
  create(context: ConversationIntegrationContext): ConversationAdapter | Promise<ConversationAdapter>;
}
