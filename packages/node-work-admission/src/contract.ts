export interface NodeWorkSession {
  token: string;
  scope: string;
  ownerPid: number;
}

export interface NodeWorkClaim {
  token: string;
  sessionToken: string;
}

export interface NodeUpgradeFreeze {
  token: string;
  scope: string;
  ownerPid: number;
}

export type NodeUpgradeFreezeResult =
  | { status: "frozen"; freeze: NodeUpgradeFreeze }
  | {
      status: "busy";
      reason:
        | "active_work"
        | "upgrade_owned"
        | "session_missing"
        | "session_conflict"
        | "config_mismatch";
    };

export class NodeWorkAdmissionError extends Error {
  constructor(
    readonly code: "admission_invalid" | "admission_claim_lost" | "admission_session_busy",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NodeWorkAdmissionError";
  }
}
