import type { ConversationPlatformDeliveryReplayPort, ConversationPlatformKind } from "./types.js";
import { ConversationPlatformError } from "./types.js";

export interface PlatformDeliveryResult {
  externalMessageKey: string;
  deliveredAt: string;
}

export class PlatformDeliveryRejectedError extends Error {
  constructor(message = "The platform API rejected message delivery.") {
    super(message);
    this.name = "PlatformDeliveryRejectedError";
  }
}

export async function deliverPlatformMessageWithReplay(input: {
  platform: ConversationPlatformKind;
  integrationId: string;
  outboundId: string;
  requestHash: string;
  attemptedAt: string;
  replay: ConversationPlatformDeliveryReplayPort;
  unknownMessage: string;
  conflictMessage: string;
  rejectedMessage: string;
  failureMessage: string;
  send: () => Promise<PlatformDeliveryResult>;
}): Promise<PlatformDeliveryResult> {
  const coordinate = {
    platform: input.platform,
    integrationId: input.integrationId,
    outboundId: input.outboundId,
    requestHash: input.requestHash,
  };
  const decision = await input.replay.begin({ ...coordinate, attemptedAt: input.attemptedAt });
  if (decision.status === "delivered") {
    return {
      externalMessageKey: decision.externalMessageKey,
      deliveredAt: decision.deliveredAt,
    };
  }
  if (decision.status !== "reserved") {
    throw new ConversationPlatformError(
      "platform_delivery_failed",
      decision.status === "unknown"
        ? input.unknownMessage
        : decision.status === "rejected"
          ? input.rejectedMessage
          : input.conflictMessage,
    );
  }
  try {
    const result = await input.send();
    await input.replay.complete({ ...coordinate, ...result });
    return result;
  } catch (error) {
    if (error instanceof PlatformDeliveryRejectedError) {
      await input.replay.markRejected(coordinate);
      throw new ConversationPlatformError("platform_delivery_failed", input.rejectedMessage);
    }
    await input.replay.markUnknown(coordinate).catch(() => undefined);
    if (error instanceof ConversationPlatformError) throw error;
    throw new ConversationPlatformError("platform_delivery_failed", input.failureMessage, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
