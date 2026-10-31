import type { ProjectStorage } from "@lervo/project-storage";

import {
  exchangeInstructionCandidates,
  type InstructionCandidateExchangeResult,
  type InstructionCandidateExchangeTransport,
} from "./instruction-candidate-exchange.js";
import {
  runInstructionCaptureCycle,
  type InstructionCaptureCycleResult,
} from "./instruction-capture-stage.js";

export interface OwnerTurnCaptureWorkResult {
  instructionCapture: InstructionCaptureCycleResult;
  candidateExchange: InstructionCandidateExchangeResult;
}

/**
 * ADR-0467 owner-turn work of one resident cycle on any host, owner or not: assess this host's
 * own queued turns under this host's delegation and budget, then exchange candidates through the
 * Hub. It writes no repository bytes, so it is not gated on the ADR-0466 convergence owner lease.
 * Each part fails closed on its own and never blocks convergence.
 */
export async function runOwnerTurnCaptureWork(input: {
  storage: ProjectStorage;
  provider: "codex" | "claude";
  executable?: string;
  admissionDirectory?: string;
  signal: AbortSignal;
  liveWorkPending(): Promise<boolean>;
  transport?: InstructionCandidateExchangeTransport;
  providerQuantum?: { remaining: number };
}): Promise<OwnerTurnCaptureWorkResult> {
  const instructionCapture = await runInstructionCaptureCycle({
    storage: input.storage,
    provider: input.provider,
    ...(input.executable === undefined ? {} : { executable: input.executable }),
    ...(input.admissionDirectory === undefined
      ? {}
      : { admissionDirectory: input.admissionDirectory }),
    signal: input.signal,
    liveWorkPending: input.liveWorkPending,
    ...(input.providerQuantum === undefined ? {} : { providerQuantum: input.providerQuantum }),
    now: () => new Date(),
  }).catch((): InstructionCaptureCycleResult => ({ status: "unavailable" }));
  const candidateExchange = await exchangeInstructionCandidates({
    storage: input.storage,
    ...(input.transport === undefined ? {} : { transport: input.transport }),
    now: () => new Date(),
  }).catch((): InstructionCandidateExchangeResult => ({ status: "unavailable" }));
  return { instructionCapture, candidateExchange };
}
