import { ConversationOperationDrain } from "@lervo/conversation-app";
import {
  SQLiteNodeWorkAdmission,
  nodeWorkAdmissionDatabasePath,
  nodeWorkAdmissionScope,
  type NodeWorkClaim,
  type NodeWorkSession,
} from "@lervo/node-work-admission";

import { NodeRuntimeError } from "./errors.js";

export interface NodeRuntimeWorkAdmission {
  drain: ConversationOperationDrain;
  close(): void;
}

/** Binds one live Node session to its exact service configuration snapshot. */
export async function openNodeRuntimeWorkAdmission(input: {
  repositoryRoot: string;
  configPath?: string;
  configDigest?: string;
}): Promise<NodeRuntimeWorkAdmission> {
  if (input.configPath === undefined) {
    return { drain: new ConversationOperationDrain(), close: () => undefined };
  }
  if (input.configDigest === undefined || !/^sha256:[a-f0-9]{64}$/u.test(input.configDigest)) {
    throw new NodeRuntimeError("invalid_config", "The Node config snapshot digest is absent.");
  }
  const store = await SQLiteNodeWorkAdmission.open({
    path: nodeWorkAdmissionDatabasePath(input.repositoryRoot),
  });
  let session: NodeWorkSession;
  try {
    session = store.registerSession({
      scope: nodeWorkAdmissionScope(input.configPath),
      configDigest: input.configDigest,
    });
  } catch (error) {
    store.close();
    throw error;
  }
  const drain = new ConversationOperationDrain({
    tryAcquire: () => store.tryAcquireWork(session),
    release: (claim) => store.releaseWork(claim as NodeWorkClaim),
  });
  let closed = false;
  return {
    drain,
    close() {
      if (closed) return;
      closed = true;
      try {
        store.unregisterSession(session);
      } finally {
        store.close();
      }
    },
  };
}
