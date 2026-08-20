import {
  type RemoteCommandDeliveryAcknowledgement,
  type RemoteCommandDeliveryConfirmation,
  type RemoteCommandLease,
  type RemoteCommandTarget,
  type SignedRemoteCommand,
} from "@lervo/schemas";

export type HubRemoteCommandQueueStatus =
  | "pending"
  | "leased"
  | "completed"
  | "rejected"
  | "expired";

export interface HubRemoteCommandEnqueueResult {
  status: "queued" | "duplicate";
  deliveryId: string;
  commandId: string;
  queueStatus: HubRemoteCommandQueueStatus;
  queuedAt: string;
}

export interface HubRemoteCommandDeliveryState {
  deliveryId: string;
  destinationId: string;
  commandId: string;
  commandHash: string;
  target: RemoteCommandTarget;
  status: HubRemoteCommandQueueStatus;
  attemptCount: number;
  queuedAt: string;
  expiresAt: string;
  terminalAt: string | null;
}

/** Command delivery state is committed before any method resolves. */
export interface HubRemoteCommandQueueStore {
  enqueueRemoteCommand(input: {
    destinationId: string;
    envelope: SignedRemoteCommand;
    queuedAt: string;
  }): Promise<HubRemoteCommandEnqueueResult>;

  leaseRemoteCommands(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    leasedTo: string;
    leasedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<RemoteCommandLease[]>;

  acknowledgeRemoteCommand(input: {
    acknowledgement: RemoteCommandDeliveryAcknowledgement;
    confirmedAt: string;
  }): Promise<RemoteCommandDeliveryConfirmation>;
}

/** Read-only operational inspection. It never returns the command or request body. */
export interface HubRemoteCommandQueueInspectionStore {
  getRemoteCommandDelivery(deliveryId: string): Promise<HubRemoteCommandDeliveryState | null>;
}
